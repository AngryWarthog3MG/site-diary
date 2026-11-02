import type { SupabaseClient } from '@supabase/supabase-js';
import { readSpec, readAnswers, type FormSpec, type Answers, type FormCategory, type FormSubject, type SignatureRule, type SubmissionStatus, type Outcome, type NcStatus, type TemplateStatus, type FormProfile } from './model';
import { nextDue, scheduleState, type Unit, type ScheduleState } from './schedule';
import { perthDate } from '@/lib/pdf/dates';

/**
 * Reading forms under the caller's RLS (README R180). The database decides what each role sees — an issued form
 * that names them, their own submissions, the record for the rest — so nothing here filters by role.
 */

export interface TemplateRow {
  id: string; org_id: string; code: string; revision: string; title: string; category: FormCategory; status: TemplateStatus; profile: FormProfile;
  audience: string[]; subject: FormSubject; spec: FormSpec; pass_mark: number | null; signature: SignatureRule; basis: string | null;
  competency_key: string | null; supersedes_id: string | null; issued_at: string | null; created_at: string;
}
const TEMPLATE_COLS = 'id, org_id, code, revision, title, category, status, profile, audience, subject, spec, pass_mark, signature, basis, competency_key, supersedes_id, issued_at, created_at';

export function asTemplate(r: Record<string, unknown>): TemplateRow {
  return { ...(r as unknown as TemplateRow), spec: readSpec(r.spec), audience: Array.isArray(r.audience) ? (r.audience as string[]) : [] };
}

/** Every form the caller may see of this company; the fill list is the issued, public ones among them. */
export async function loadTemplates(supabase: SupabaseClient, orgId: string): Promise<TemplateRow[]> {
  const { data, error } = await supabase.from('form_templates').select(TEMPLATE_COLS).eq('org_id', orgId).order('code').order('revision', { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map(asTemplate);
}

export interface SubmissionRow {
  id: string; project_id: string; template_id: string; template_code: string; template_title: string; revision: string; category: FormCategory;
  spec: FormSpec; pass_mark: number | null; signature_rule: SignatureRule; subject: FormSubject; subject_plant_id: string | null; subject_person: string | null;
  header: Record<string, unknown>; answers: Answers; status: SubmissionStatus; score: number | null; outcome: Outcome | null;
  started_by: string; started_at: string; completed_by: string | null; completed_at: string | null; completed_on_device_at: string | null;
  signature_path: string | null; voided_at: string | null; voided_by: string | null; void_reason: string | null; schedule_id: string | null;
}
const SUBMISSION_COLS = 'id, project_id, template_id, template_code, template_title, revision, category, spec, pass_mark, signature_rule, subject, subject_plant_id, subject_person, header, answers, status, score, outcome, started_by, started_at, completed_by, completed_at, completed_on_device_at, signature_path, voided_at, voided_by, void_reason, schedule_id';

export function asSubmission(r: Record<string, unknown>): SubmissionRow {
  return {
    ...(r as unknown as SubmissionRow),
    spec: readSpec(r.spec), answers: readAnswers(r.answers),
    header: (r.header && typeof r.header === 'object' ? r.header : {}) as Record<string, unknown>,
    score: r.score == null ? null : Number(r.score),
  };
}

export async function loadSubmission(supabase: SupabaseClient, id: string): Promise<SubmissionRow | null> {
  const { data } = await supabase.from('form_submissions').select(SUBMISSION_COLS).eq('id', id).maybeSingle();
  return data ? asSubmission(data as Record<string, unknown>) : null;
}

/** The job's register, newest first; `?month=YYYY-MM` narrows it. */
export async function loadSubmissions(supabase: SupabaseClient, projectId: string, opts: { month?: string | null; limit?: number } = {}): Promise<SubmissionRow[]> {
  let q = supabase.from('form_submissions').select(SUBMISSION_COLS).eq('project_id', projectId);
  if (opts.month && /^\d{4}-\d{2}$/.test(opts.month)) {
    const [y, m] = opts.month.split('-').map(Number);
    const from = `${opts.month}-01`;
    const to = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`;
    q = q.gte('started_at', `${from}T00:00:00+08:00`).lt('started_at', `${to}T00:00:00+08:00`);
  }
  const { data, error } = await q.order('started_at', { ascending: false }).limit(opts.limit ?? 300);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map(asSubmission);
}

export interface NcRow {
  id: string; submission_id: string; project_id: string; question_key: string; question_label: string; answer: string | null; note: string | null;
  photo_paths: string[]; status: NcStatus; resolution: string | null; resolved_by: string | null; resolved_at: string | null; removed_reason: string | null;
  removed_at: string | null; raised_as_action: boolean; action: string | null; priority: 'normal' | 'high' | 'critical'; owner_name: string | null;
  assigned_to: string | null; due_on: string | null; done_at: string | null; created_at: string;
  /** The form it came from, for the register. */
  form: { template_code: string; template_title: string; completed_at: string | null; subject_person: string | null } | null;
}
const NC_COLS = 'id, submission_id, project_id, question_key, question_label, answer, note, photo_paths, status, resolution, resolved_by, resolved_at, removed_reason, removed_at, raised_as_action, action, priority, owner_name, assigned_to, due_on, done_at, created_at, form:form_submissions!inner(template_code, template_title, completed_at, subject_person)';

const asNc = (r: Record<string, unknown>): NcRow => {
  const f = r.form as NcRow['form'] | NcRow['form'][] | null;
  return { ...(r as unknown as NcRow), photo_paths: Array.isArray(r.photo_paths) ? (r.photo_paths as string[]) : [], form: Array.isArray(f) ? f[0] ?? null : f };
};

export async function loadNonCompliances(supabase: SupabaseClient, where: { projectId?: string; submissionId?: string }, opts: { includeClosed?: boolean } = {}): Promise<NcRow[]> {
  let q = supabase.from('form_non_compliances').select(NC_COLS);
  if (where.submissionId) q = q.eq('submission_id', where.submissionId);
  else if (where.projectId) q = q.eq('project_id', where.projectId);
  if (!opts.includeClosed) q = q.eq('status', 'open');
  const { data, error } = await q.order('created_at', { ascending: false }).limit(500);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map(asNc);
}

/** Names behind account ids, for "started by" and "resolved by". */
export async function namesFor(supabase: SupabaseClient, ids: Iterable<string | null | undefined>): Promise<Map<string, string>> {
  const set = [...new Set([...ids].filter((v): v is string => Boolean(v)))];
  const out = new Map<string, string>();
  if (set.length === 0) return out;
  const { data } = await supabase.from('profiles').select('id, full_name, email').in('id', set);
  for (const p of (data ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>) out.set(p.id, p.full_name ?? p.email ?? 'Unnamed');
  return out;
}

// ---------------------------------------------------------------------------
// Schedules (README R181).
// ---------------------------------------------------------------------------

export interface ScheduleRow {
  id: string; org_id: string; project_id: string | null; template_code: string; assigned_to: string | null; subject_plant_id: string | null;
  subject_person: string | null; every: number; unit: Unit; first_due_on: string; active: boolean; notes: string | null; last_reminded_on: string | null;
  created_by: string | null; created_at: string;
}
const SCHEDULE_COLS = 'id, org_id, project_id, template_code, assigned_to, subject_plant_id, subject_person, every, unit, first_due_on, active, notes, last_reminded_on, created_by, created_at';

export interface ScheduleView extends ScheduleRow {
  /** The current issued revision of the form the schedule names; null when none is issued (nothing can be filled). */
  template: { id: string; title: string; subject: FormSubject; basis: string | null; category: FormCategory } | null;
  lastDoneOn: string | null;
  nextDue: string | null;
  state: ScheduleState;
  machine: string | null;
  assignee: string | null;
  /** What it is about, for a line on a screen. */
  about: string | null;
}

/**
 * The schedules that reach a job — its own and the company-wide ones — with the next due read off the last COMPLETED
 * form each produced (never stored), the current issued revision of the form, and the names. Under the caller's
 * RLS: a labourer gets the ones assigned to them and no other. `projectId` null = every schedule of the company.
 */
export async function loadSchedules(supabase: SupabaseClient, orgId: string, projectId: string | null, today: string): Promise<ScheduleView[]> {
  let q = supabase.from('form_schedules').select(SCHEDULE_COLS).eq('org_id', orgId);
  if (projectId) q = q.or(`project_id.eq.${projectId},project_id.is.null`);
  const { data, error } = await q.order('first_due_on');
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as ScheduleRow[];
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [{ data: done }, { data: tpls }, { data: plant }] = await Promise.all([
    supabase.from('form_submissions').select('schedule_id, completed_at, completed_on_device_at').in('schedule_id', ids).eq('status', 'completed'),
    supabase.from('form_templates').select('id, code, title, subject, basis, category').eq('org_id', orgId).eq('status', 'issued'),
    supabase.from('plant_register').select('id, name, plant_no').in('id', [...new Set(rows.map((r) => r.subject_plant_id).filter((v): v is string => Boolean(v)))]),
  ]);
  const lastDone = new Map<string, string>();
  for (const d of (done ?? []) as Array<{ schedule_id: string; completed_at: string | null; completed_on_device_at: string | null }>) {
    const day = perthDate(d.completed_on_device_at ?? d.completed_at);
    if (!day) continue;
    const prev = lastDone.get(d.schedule_id);
    if (!prev || day > prev) lastDone.set(d.schedule_id, day);
  }
  const tplByCode = new Map<string, ScheduleView['template']>();
  for (const t of (tpls ?? []) as Array<{ id: string; code: string; title: string; subject: FormSubject; basis: string | null; category: FormCategory }>) tplByCode.set(t.code, t);
  const machineOf = new Map<string, string>();
  for (const p of (plant ?? []) as Array<{ id: string; name: string; plant_no: string | null }>) machineOf.set(p.id, p.plant_no ? `${p.name} · ${p.plant_no}` : p.name);
  const nameOf = await namesFor(supabase, rows.map((r) => r.assigned_to));
  return rows.map((r) => {
    const last = lastDone.get(r.id) ?? null;
    const due = nextDue(r, last);
    const machine = r.subject_plant_id ? machineOf.get(r.subject_plant_id) ?? 'a machine' : null;
    return {
      ...r, template: tplByCode.get(r.template_code) ?? null, lastDoneOn: last, nextDue: due, state: scheduleState(due, today),
      machine, assignee: r.assigned_to ? nameOf.get(r.assigned_to) ?? 'someone' : null, about: machine ?? r.subject_person,
    };
  });
}

/** Where a schedule's form is filled: the current issued revision, with the schedule named. */
export function fillHref(s: ScheduleView, projectId: string): string | null {
  return s.template ? `/forms/fill/new?project=${projectId}&template=${s.template.id}&schedule=${s.id}` : null;
}
