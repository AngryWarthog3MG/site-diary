import type { SupabaseClient } from '@supabase/supabase-js';
import { addDays, buildTimesheet, type LabourFact, type Timesheet } from './model';

export interface TimesheetLoad {
  sheet: Timesheet;
  /** Draft corrections in the week: the signed original still counts until the correction is signed. */
  pendingCorrections: number;
}

/**
 * The week's labour rows under the caller's RLS — every job they are on, nothing
 * else — with a corrected day counted once (README R103, the rule from the claims
 * register): a signed correction replaces its original; a draft correction does not,
 * so the original stands and the draft is noted. Unsigned originals are shown and
 * marked, never hidden — the sheet says what is still to be signed.
 */
export async function loadTimesheet(supabase: SupabaseClient, monday: string): Promise<TimesheetLoad> {
  const to = addDays(monday, 6);
  const { data: entries, error } = await supabase
    .from('entries')
    .select('id, project_id, entry_date, status, supersedes_entry_id, project:projects!inner(code, name)')
    .gte('entry_date', monday)
    .lte('entry_date', to);
  if (error) throw new Error(error.message);
  type E = { id: string; project_id: string; entry_date: string; status: string; supersedes_entry_id: string | null; project: { code: string; name: string } | { code: string; name: string }[] };
  const rows = (entries ?? []) as E[];
  const superseded = new Set(rows.filter((e) => e.status === 'signed' && e.supersedes_entry_id).map((e) => e.supersedes_entry_id as string));
  const pending = rows.filter((e) => e.status !== 'signed' && e.supersedes_entry_id);
  const current = rows.filter((e) => !superseded.has(e.id) && !(e.status !== 'signed' && e.supersedes_entry_id));
  const byId = new Map(current.map((e) => [e.id, e]));
  const ids = current.map((e) => e.id);
  const labour = ids.length
    ? await supabase.from('labour').select('entry_id, person_name, role, hours, overtime_hours').in('entry_id', ids)
    : { data: [], error: null };
  if (labour.error) throw new Error(labour.error.message);
  type L = { entry_id: string; person_name: string; role: string | null; hours: number | string | null; overtime_hours: number | string | null };
  const num = (v: number | string | null) => (v == null || v === '' ? null : Number(v));
  const facts: LabourFact[] = [];
  for (const l of (labour.data ?? []) as L[]) {
    const e = byId.get(l.entry_id);
    if (!e) continue;
    const project = Array.isArray(e.project) ? e.project[0] : e.project;
    facts.push({
      entryId: e.id, projectId: e.project_id, projectCode: project.code, projectName: project.name,
      date: e.entry_date, signed: e.status === 'signed',
      personName: l.person_name ?? '', role: l.role, hours: num(l.hours), overtimeHours: num(l.overtime_hours),
    });
  }
  return { sheet: buildTimesheet(facts, monday), pendingCorrections: pending.length };
}
