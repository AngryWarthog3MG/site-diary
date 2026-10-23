import type { SupabaseClient } from '@supabase/supabase-js';
import { recordState, type ItemResult, type QaTemplate, type RecordSignoff, type RecordState } from './model';

/** A template as the job reads it: the row and its form. */
export interface QaTemplateRow { id: string; code: string; revision: string; kind: QaTemplate['kind']; title: string; governing_itp: string | null; issued_at: string | null; spec: QaTemplate }

export interface QaInstanceRow {
  id: string; project_id: string; template_id: string; status: 'draft' | 'issued' | 'approved' | 'signed';
  issued_to: string | null; issued_at: string | null; approved_by_name: string | null; approved_at: string | null;
  approval_file_path: string | null; signed_at: string | null; voided_at: string | null; void_reason: string | null;
}

export interface QaRecordRow {
  id: string; project_id: string; template_id: string; itp_instance_id: string | null; activity_no: string | null;
  lot_or_element: string | null; header: Record<string, unknown>; items: ItemResult[]; rows: Array<Record<string, unknown>>;
  comments: string | null; signoffs: RecordSignoff[]; gap_count: number; submitted_at: string | null; completed_at: string | null;
  released_at: string | null; client_created_at: string; created_by: string | null; created_at: string; updated_at: string;
  voided_at: string | null; void_reason: string | null; diary_entry_id: string | null;
  /** Photographs of the record as a whole (README R166). */
  photo_paths: string[];
}

export interface QaRecordSummary { row: QaRecordRow; state: RecordState }

/** One ITP on the job with the ITRs it governs and every record filled in against them (README R164). */
export interface QaItpBlock {
  instance: QaInstanceRow;
  template: QaTemplateRow;
  forms: Array<{ template: QaTemplateRow; records: QaRecordSummary[] }>;
}

export interface QaHome {
  itps: QaItpBlock[];
  /** Issued ITP templates with no instance on this job yet — the office picks one to bring on. */
  available: QaTemplateRow[];
  /** Forms governed by no ITP on this job (site forms), with their records. */
  other: Array<{ template: QaTemplateRow; records: QaRecordSummary[] }>;
}

const num = (v: unknown) => (typeof v === 'number' ? v : Number(v ?? 0));

function asTemplate(r: Record<string, unknown>): QaTemplateRow {
  return { id: String(r.id), code: String(r.code), revision: String(r.revision), kind: r.kind as QaTemplate['kind'], title: String(r.title), governing_itp: (r.governing_itp as string | null) ?? null, issued_at: (r.issued_at as string | null) ?? null, spec: r.spec as QaTemplate };
}
function asRecord(r: Record<string, unknown>): QaRecordRow {
  return {
    ...(r as unknown as QaRecordRow),
    header: (r.header as Record<string, unknown>) ?? {},
    items: Array.isArray(r.items) ? (r.items as ItemResult[]) : [],
    rows: Array.isArray(r.rows) ? (r.rows as Array<Record<string, unknown>>) : [],
    signoffs: Array.isArray(r.signoffs) ? (r.signoffs as RecordSignoff[]) : [],
    gap_count: num(r.gap_count),
    photo_paths: Array.isArray(r.photo_paths) ? (r.photo_paths as string[]) : [],
  };
}

const RECORD_COLS = 'id, project_id, template_id, itp_instance_id, activity_no, lot_or_element, header, items, rows, comments, signoffs, gap_count, submitted_at, completed_at, released_at, client_created_at, created_by, created_at, updated_at, voided_at, void_reason, diary_entry_id, photo_paths';
const TEMPLATE_COLS = 'id, code, revision, kind, title, governing_itp, issued_at, spec';

/** The job's QA at a glance, under the caller's RLS: its ITPs, their ITRs, and the records against each. */
export async function loadQaHome(supabase: SupabaseClient, orgId: string, projectId: string): Promise<QaHome> {
  const [templates, instances, records] = await Promise.all([
    supabase.from('qa_templates').select(TEMPLATE_COLS).eq('org_id', orgId).not('issued_at', 'is', null).is('retired_at', null).order('code').order('revision'),
    supabase.from('qa_itp_instances').select('id, project_id, template_id, status, issued_to, issued_at, approved_by_name, approved_at, approval_file_path, signed_at, voided_at, void_reason').eq('project_id', projectId).is('voided_at', null).order('created_at'),
    supabase.from('qa_records').select(RECORD_COLS).eq('project_id', projectId).order('updated_at', { ascending: false }),
  ]);
  for (const r of [templates, instances, records]) if (r.error) throw new Error(r.error.message);
  const ts = ((templates.data ?? []) as Array<Record<string, unknown>>).map(asTemplate);
  const byId = new Map(ts.map((t) => [t.id, t]));
  // The newest issued revision of each code is the one a new record is written against.
  const latestByCode = new Map<string, QaTemplateRow>();
  for (const t of ts) latestByCode.set(t.code, t);
  const recs = ((records.data ?? []) as Array<Record<string, unknown>>).map(asRecord);
  const summarise = (r: QaRecordRow): QaRecordSummary => {
    const t = byId.get(r.template_id);
    return { row: r, state: t ? recordState(t.spec, r) : 'in_progress' };
  };
  const recordsByTemplate = new Map<string, QaRecordSummary[]>();
  for (const r of recs) recordsByTemplate.set(r.template_id, [...(recordsByTemplate.get(r.template_id) ?? []), summarise(r)]);
  const forTemplateCode = (code: string) => {
    const revisions = ts.filter((t) => t.code === code);
    return revisions.flatMap((t) => recordsByTemplate.get(t.id) ?? []);
  };

  const itps: QaItpBlock[] = [];
  const governedCodes = new Set<string>();
  for (const inst of (instances.data ?? []) as QaInstanceRow[]) {
    const t = byId.get(inst.template_id);
    if (!t) continue;
    const forms = [...latestByCode.values()]
      .filter((f) => f.kind !== 'itp' && f.governing_itp === t.code)
      .map((f) => { governedCodes.add(f.code); return { template: f, records: forTemplateCode(f.code) }; });
    itps.push({ instance: inst, template: t, forms });
  }
  const instanced = new Set(itps.map((b) => b.template.code));
  const available = [...latestByCode.values()].filter((t) => t.kind === 'itp' && !instanced.has(t.code));
  const other = [...latestByCode.values()]
    .filter((t) => t.kind !== 'itp' && !governedCodes.has(t.code) && (t.kind === 'site_form' || forTemplateCode(t.code).length > 0))
    .map((t) => ({ template: t, records: forTemplateCode(t.code) }));
  return { itps, available, other };
}

/** One record and its form, or the form alone for a record not yet begun. */
export async function loadQaRecord(supabase: SupabaseClient, projectId: string, recordId: string, templateId: string | null): Promise<{ record: QaRecordRow | null; template: QaTemplateRow; instance: QaInstanceRow | null } | null> {
  const { data: rec, error } = await supabase.from('qa_records').select(RECORD_COLS).eq('id', recordId).eq('project_id', projectId).maybeSingle();
  if (error) throw new Error(error.message);
  const record = rec ? asRecord(rec as Record<string, unknown>) : null;
  const tid = record?.template_id ?? templateId;
  if (!tid) return null;
  const { data: t, error: tErr } = await supabase.from('qa_templates').select(TEMPLATE_COLS).eq('id', tid).maybeSingle();
  if (tErr) throw new Error(tErr.message);
  if (!t) return null;
  let instance: QaInstanceRow | null = null;
  if (record?.itp_instance_id) {
    const { data: inst } = await supabase.from('qa_itp_instances').select('id, project_id, template_id, status, issued_to, issued_at, approved_by_name, approved_at, approval_file_path, signed_at, voided_at, void_reason').eq('id', record.itp_instance_id).maybeSingle();
    instance = (inst as QaInstanceRow | null) ?? null;
  }
  return { record, template: asTemplate(t as Record<string, unknown>), instance };
}

/** One ITP instance with its form and the records against its ITRs. */
export async function loadQaInstance(supabase: SupabaseClient, projectId: string, instanceId: string, orgId: string): Promise<QaItpBlock | null> {
  const home = await loadQaHome(supabase, orgId, projectId);
  return home.itps.find((b) => b.instance.id === instanceId) ?? null;
}
