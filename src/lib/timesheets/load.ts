import type { SupabaseClient } from '@supabase/supabase-js';
import { addDays, buildTimesheet, makeResolver, normName, type LabourFact, type Timesheet } from './model';

export interface TimesheetLoad {
  sheet: Timesheet;
  /** Draft corrections in the week: the signed original still counts until the correction is signed. */
  pendingCorrections: number;
  /** The company's list of names that are one person (README R107), for the screen to show and undo. */
  combined: Array<{ id: string; orgId: string; alias: string; name: string; note: string | null }>;
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
    .select('id, project_id, entry_date, status, supersedes_entry_id, project:projects!inner(code, name, org_id)')
    .gte('entry_date', monday)
    .lte('entry_date', to);
  if (error) throw new Error(error.message);
  type P = { code: string; name: string; org_id: string };
  type E = { id: string; project_id: string; entry_date: string; status: string; supersedes_entry_id: string | null; project: P | P[] };
  const rows = (entries ?? []) as E[];
  const superseded = new Set(rows.filter((e) => e.status === 'signed' && e.supersedes_entry_id).map((e) => e.supersedes_entry_id as string));
  const pending = rows.filter((e) => e.status !== 'signed' && e.supersedes_entry_id);
  const current = rows.filter((e) => !superseded.has(e.id) && !(e.status !== 'signed' && e.supersedes_entry_id));
  const byId = new Map(current.map((e) => [e.id, e]));
  const ids = current.map((e) => e.id);
  const labour = ids.length
    ? await supabase.from('labour').select('entry_id, person_name, role, hours, overtime_hours, start_time, finish_time').in('entry_id', ids)
    : { data: [], error: null };
  if (labour.error) throw new Error(labour.error.message);

  // One person, one row (README R107): each job's crew nicknames on its own rows, the company's list everywhere.
  const projectIds = [...new Set(current.map((e) => e.project_id))];
  const orgIds = [...new Set(current.map((e) => (Array.isArray(e.project) ? e.project[0] : e.project).org_id))];
  const [crew, companyList] = await Promise.all([
    projectIds.length ? supabase.from('crew').select('project_id, name, aliases').in('project_id', projectIds) : Promise.resolve({ data: [], error: null }),
    orgIds.length ? supabase.from('person_aliases').select('id, org_id, alias, name, note').in('org_id', orgIds).order('alias') : Promise.resolve({ data: [], error: null }),
  ]);
  if (crew.error) throw new Error(crew.error.message);
  if (companyList.error) throw new Error(companyList.error.message);
  const combined = ((companyList.data ?? []) as Array<{ id: string; org_id: string; alias: string; name: string; note: string | null }>)
    .map((c) => ({ id: c.id, orgId: c.org_id, alias: c.alias, name: c.name, note: c.note }));
  const resolve = makeResolver(
    ((crew.data ?? []) as Array<{ project_id: string; name: string; aliases: string[] | null }>).map((c) => ({ projectId: c.project_id, name: c.name, aliases: c.aliases })),
    combined,
  );
  type L = { entry_id: string; person_name: string; role: string | null; hours: number | string | null; overtime_hours: number | string | null; start_time: string | null; finish_time: string | null };
  const num = (v: number | string | null) => (v == null || v === '' ? null : Number(v));
  const facts: LabourFact[] = [];
  for (const l of (labour.data ?? []) as L[]) {
    const e = byId.get(l.entry_id);
    if (!e) continue;
    const project = Array.isArray(e.project) ? e.project[0] : e.project;
    facts.push({
      entryId: e.id, projectId: e.project_id, projectCode: project.code, projectName: project.name,
      date: e.entry_date, signed: e.status === 'signed',
      personName: resolve(l.person_name ?? '', e.project_id), role: l.role, hours: num(l.hours), overtimeHours: num(l.overtime_hours),
      saidAs: normName(resolve(l.person_name ?? '', e.project_id)) !== normName(l.person_name ?? '') ? (l.person_name ?? '').trim() : undefined,
      start: l.start_time, finish: l.finish_time,
    });
  }
  return { sheet: buildTimesheet(facts, monday), pendingCorrections: pending.length, combined };
}
