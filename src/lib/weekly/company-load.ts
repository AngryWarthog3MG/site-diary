import type { SupabaseClient } from '@supabase/supabase-js';
import type { Membership } from '@/lib/auth';
import { sees } from '@/lib/roles';
import { makeResolver } from '@/lib/timesheets/model';
import { loadWeeklyData } from './load';
import { rollUp, summariseJob, type CompanyWeek, type JobWeek } from './company';

/**
 * Every job's week (README R108), each through the job's own weekly loader under the caller's RLS — so the company
 * report and each job's report can never disagree — for every active job the caller may open the weekly on. Unsigned
 * days are in and marked, as on the job's report. A job that cannot be read is listed with why, never dropped.
 */
export async function loadCompanyWeek(supabase: SupabaseClient, memberships: Membership[], start: string, end: string): Promise<CompanyWeek> {
  const jobs = memberships.filter((m) => m.project.active && sees(m, 'weekly'));
  const ids = jobs.map((m) => m.project_id);
  const orgs = [...new Set(jobs.map((m) => m.project.org.id))];
  // When each job began: its start date, else its first diary; neither means not started (README R108).
  const [{ data: starts }, ...firsts] = await Promise.all([
    ids.length ? supabase.from('projects').select('id, start_on').in('id', ids) : Promise.resolve({ data: [] }),
    ...ids.map((id) => supabase.from('entries').select('entry_date').eq('project_id', id).order('entry_date').limit(1)),
  ]);
  const startsOn = new Map<string, string | null>(ids.map((id, i) => {
    const set = ((starts ?? []) as Array<{ id: string; start_on: string | null }>).find((s) => s.id === id)?.start_on ?? null;
    const first = ((firsts[i] as { data: Array<{ entry_date: string }> | null }).data ?? [])[0]?.entry_date ?? null;
    return [id, set ?? first];
  }));
  const [crew, company] = await Promise.all([
    ids.length ? supabase.from('crew').select('project_id, name, aliases').in('project_id', ids) : Promise.resolve({ data: [] }),
    orgs.length ? supabase.from('person_aliases').select('alias, name').in('org_id', orgs) : Promise.resolve({ data: [] }),
  ]);
  const resolve = makeResolver(
    ((crew.data ?? []) as Array<{ project_id: string; name: string; aliases: string[] | null }>).map((c) => ({ projectId: c.project_id, name: c.name, aliases: c.aliases })),
    (company.data ?? []) as Array<{ alias: string; name: string }>,
  );
  const results = await Promise.allSettled(jobs.map((m) =>
    loadWeeklyData(supabase, { id: m.project_id, name: m.project.name, code: m.project.code, orgCode: m.project.org.code }, start, end, { includeUnsigned: true })));
  const weeks: JobWeek[] = [];
  const failed: CompanyWeek['failed'] = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') weeks.push(summariseJob(r.value, (n) => resolve(n, jobs[i].project_id), startsOn.get(jobs[i].project_id) ?? null));
    else failed.push({ code: jobs[i].project.code, name: jobs[i].project.name, message: r.reason instanceof Error ? r.reason.message : 'Could not load the week.' });
  });
  return rollUp(start, end, weeks, failed);
}
