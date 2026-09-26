import type { SupabaseClient } from '@supabase/supabase-js';
import { loadPlantOnJob } from '@/lib/plant/on-job';
import { norm, type CostKind, type CostLine, type DiaryDay, type RateItem } from './costs';

export interface BuildUpRegister {
  id: string;
  project_id: string;
  seq: number;
  title: string;
  status: string;
  vr_ref: string | null;
  estimated_cost: number | null;
  agreed_cost: number | null;
  estimate_source: 'manual' | 'build_up';
  notes: string | null;
}

export interface BuildUpDay extends DiaryDay {
  entryNo: string | null;
}

export interface BuildUpData {
  register: BuildUpRegister;
  project: { id: string; code: string; name: string; orgId: string };
  lines: CostLine[];
  rates: RateItem[];
  /** Every machine the page may name: the job's plant, and any a rate or a line points at. */
  plant: Array<{ id: string; name: string; plant_no: string | null; onJob: boolean }>;
  days: BuildUpDay[];
  /** Diary days a line came from that a signed correction has since replaced. */
  staleEntries: string[];
  /** Each time it was submitted: when, and the total and line count as they stood (README R104). */
  submissions: Array<{ at: string; total: number | null; lines: number | null }>;
  /** The job's other variations, for moving between them without going back. */
  siblings: Array<{ id: string; seq: number; title: string; status: string; value: number | null }>;
}

const num = (v: unknown): number | null => (v == null || v === '' ? null : Number(v));

/**
 * One variation's build-up under the caller's RLS (README R104). The lines and the rates come back only for
 * someone who keeps the registers; anyone else gets the variation and its days with no money.
 */
export async function loadBuildUp(supabase: SupabaseClient, registerId: string): Promise<BuildUpData | null> {
  const { data: reg, error: regErr } = await supabase
    .from('variation_register')
    .select('id, project_id, seq, title, status, vr_ref, estimate_source, notes')
    .eq('id', registerId)
    .maybeSingle();
  if (regErr) throw new Error(regErr.message);
  if (!reg) return null;
  const { data: project, error: pErr } = await supabase.from('projects').select('id, code, name, org_id').eq('id', reg.project_id).maybeSingle();
  if (pErr || !project) throw new Error(pErr?.message ?? 'The job for this variation is not on your account.');

  const [lines, rates, plantOnJob, links, versions, events, siblings, values] = await Promise.all([
    supabase.from('variation_cost_lines')
      .select('id, register_id, kind, description, person_name, plant_id, rate_item_id, source_entry_id, source_variation_id, work_date, quantity, unit, rate, amount, note')
      .eq('register_id', registerId),
    supabase.from('rate_items')
      .select('id, org_id, project_id, kind, label, plant_id, unit, rate, notes, active')
      .eq('org_id', project.org_id)
      .or(`project_id.is.null,project_id.eq.${project.id}`),
    loadPlantOnJob(supabase, project.id),
    supabase.from('variation_register_links')
      .select('variation:variations(id, crew, hours, description, entry:entries!inner(id, entry_no, entry_date, status, project_id))')
      .eq('register_id', registerId),
    supabase.from('entries').select('id, status, supersedes_entry_id').eq('project_id', project.id),
    supabase.rpc('variation_submissions', { p_register: registerId }),
    supabase.from('variation_register').select('id, seq, title, status').eq('project_id', project.id).order('seq'),
    supabase.rpc('variation_values', { p_project: project.id }),
  ]);
  for (const r of [lines, rates, links, versions, events, siblings, values]) if (r.error) throw new Error(r.error.message);
  // Values come only through the locked function (README R105).
  const money = new Map(((values.data ?? []) as Array<{ register_id: string; estimated_cost: unknown; agreed_cost: unknown }>).map((v) => [v.register_id, v]));

  const costLines: CostLine[] = ((lines.data ?? []) as Array<Record<string, unknown>>).map((l) => ({
    id: String(l.id), register_id: String(l.register_id), kind: l.kind as CostKind, description: String(l.description),
    person_name: (l.person_name as string | null) ?? null, plant_id: (l.plant_id as string | null) ?? null,
    rate_item_id: (l.rate_item_id as string | null) ?? null, source_entry_id: (l.source_entry_id as string | null) ?? null,
    source_variation_id: (l.source_variation_id as string | null) ?? null,
    work_date: (l.work_date as string | null) ?? null, quantity: num(l.quantity), unit: String(l.unit), rate: num(l.rate),
    amount: num(l.amount), note: (l.note as string | null) ?? null,
  }));
  const rateItems: RateItem[] = ((rates.data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id), org_id: String(r.org_id), project_id: (r.project_id as string | null) ?? null, kind: r.kind as CostKind,
    label: String(r.label), plant_id: (r.plant_id as string | null) ?? null, unit: String(r.unit), rate: Number(r.rate),
    notes: (r.notes as string | null) ?? null, active: Boolean(r.active),
  }));

  // A corrected day counts once — superseded only by a SIGNED correction (the claims register's rule, R85).
  const superseded = new Set(((versions.data ?? []) as Array<{ status: string; supersedes_entry_id: string | null }>)
    .filter((e) => e.status === 'signed' && e.supersedes_entry_id).map((e) => e.supersedes_entry_id as string));
  type Link = { variation: { crew: string[] | null; hours: unknown; description: string | null; entry: { id: string; entry_no: string | null; entry_date: string; status: string } | Array<{ id: string; entry_no: string | null; entry_date: string; status: string }> } | null | Array<unknown> };
  const days: BuildUpDay[] = [];
  for (const link of (links.data ?? []) as unknown as Link[]) {
    const v = (Array.isArray(link.variation) ? link.variation[0] : link.variation) as { id: string; crew: string[] | null; hours: unknown; description: string | null; entry: unknown } | null;
    const entry = v ? ((Array.isArray(v.entry) ? v.entry[0] : v.entry) as { id: string; entry_no: string | null; entry_date: string; status: string } | null) : null;
    if (!v || !entry || superseded.has(entry.id)) continue;
    days.push({ variationId: v.id, entryId: entry.id, entryNo: entry.status === 'signed' ? entry.entry_no : null, date: entry.entry_date, signed: entry.status === 'signed', hours: num(v.hours), crew: v.crew ?? [], roles: {}, description: v.description ?? null });
  }
  days.sort((a, b) => a.date.localeCompare(b.date) || (a.description ?? '').localeCompare(b.description ?? ''));
  // Who worked as what, from each day's labour list.
  if (days.length) {
    const { data: labour, error } = await supabase.from('labour').select('entry_id, person_name, role').in('entry_id', days.map((d) => d.entryId));
    if (error) throw new Error(error.message);
    for (const l of (labour ?? []) as Array<{ entry_id: string; person_name: string | null; role: string | null }>) {
      const d = days.find((x) => x.entryId === l.entry_id);
      if (d && l.person_name) d.roles[norm(l.person_name)] = l.role?.trim() || null;
    }
  }

  // Machines: the job's, plus any a rate or a line names that is not on the job.
  const plant = new Map<string, { id: string; name: string; plant_no: string | null; onJob: boolean }>();
  for (const p of plantOnJob) plant.set(p.id, { id: p.id, name: p.name, plant_no: p.plant_no ?? null, onJob: true });
  const extra = [...new Set([...rateItems.map((r) => r.plant_id), ...costLines.map((l) => l.plant_id)].filter((x): x is string => Boolean(x) && !plant.has(x as string)))];
  if (extra.length) {
    const { data: more } = await supabase.from('plant_register').select('id, name, plant_no').in('id', extra);
    for (const p of (more ?? []) as Array<{ id: string; name: string; plant_no: string | null }>) plant.set(p.id, { ...p, onJob: false });
  }

  return {
    register: {
      id: reg.id, project_id: reg.project_id, seq: reg.seq, title: reg.title, status: reg.status, vr_ref: reg.vr_ref,
      estimated_cost: num(money.get(reg.id)?.estimated_cost), agreed_cost: num(money.get(reg.id)?.agreed_cost), estimate_source: (reg.estimate_source ?? 'manual') as 'manual' | 'build_up', notes: reg.notes,
    },
    project: { id: project.id, code: project.code, name: project.name, orgId: project.org_id },
    lines: costLines,
    rates: rateItems,
    plant: [...plant.values()].sort((a, b) => Number(b.onJob) - Number(a.onJob) || a.name.localeCompare(b.name)),
    days,
    staleEntries: [...new Set(costLines.map((l) => l.source_entry_id).filter((x): x is string => Boolean(x) && superseded.has(x as string)))],
    submissions: ((events.data ?? []) as Array<{ changed_at: string; claimed_total: unknown; claimed_lines: unknown }>).map((e) => ({ at: e.changed_at, total: num(e.claimed_total), lines: num(e.claimed_lines) })),
    siblings: ((siblings.data ?? []) as Array<{ id: string; seq: number; title: string; status: string }>)
      .map((s) => ({ id: s.id, seq: s.seq, title: s.title, status: s.status, value: num(money.get(s.id)?.agreed_cost) ?? num(money.get(s.id)?.estimated_cost) })),
  };
}
