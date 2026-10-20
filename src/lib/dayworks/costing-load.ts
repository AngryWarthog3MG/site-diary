import type { SupabaseClient } from '@supabase/supabase-js';
import { makeResolver } from '@/lib/timesheets/model';
import { costLine, normName, peopleInPeriod, rateIndex, totalCosts, type CostTotals, type LineCost, type PersonInPeriod, type PersonRate } from './costing';
import type { DayworkLine, DayworksSchedule } from './schedule';

export interface DayworksCosting {
  /** Beside each line given, in the same order. */
  costs: LineCost[];
  /** Per week, in the schedule's order. */
  weeks: CostTotals[];
  totals: CostTotals;
  people: PersonInPeriod[];
  /** The company's live rates by person, for the block that sets them. */
  rates: Array<PersonRate & { id: string; notes: string | null }>;
}

/**
 * The period's items costed by person (README R158), under the caller's RLS: the rates come back only for someone
 * who sees the money with their code entered — anyone else gets an empty card, and the page shows no money. Names on
 * the signed rows are resolved the way the timesheet resolves them (R107): the job's crew nicknames, then the
 * company's list of names that are one person, so a row signed as "Matty Rogers" costs at Matthew Rodgers' rate.
 */
export async function loadDayworksCosting(supabase: SupabaseClient, orgId: string, projectId: string, schedule: DayworksSchedule, lines: readonly DayworkLine[]): Promise<DayworksCosting> {
  const [rates, crew, aliases, staff] = await Promise.all([
    supabase.from('person_rates').select('id, person_name, rate, notes, active').eq('org_id', orgId),
    supabase.from('crew').select('project_id, name, aliases').eq('project_id', projectId),
    supabase.from('person_aliases').select('alias, name').eq('org_id', orgId),
    supabase.from('staff').select('name').eq('org_id', orgId),
  ]);
  for (const r of [rates, crew, aliases, staff]) if (r.error) throw new Error(r.error.message);
  const resolveOn = makeResolver(
    ((crew.data ?? []) as Array<{ project_id: string; name: string; aliases: string[] | null }>).map((c) => ({ projectId: c.project_id, name: c.name, aliases: c.aliases })),
    (aliases.data ?? []) as Array<{ alias: string; name: string }>,
  );
  // The staff list is the person (R123): a row signed "Jay galloway" is Jay Galloway's, spelt as the list spells it.
  const spelt = new Map(((staff.data ?? []) as Array<{ name: string }>).map((s) => [normName(s.name), s.name]));
  const resolve = (name: string) => { const r = resolveOn(name, projectId); return spelt.get(normName(r)) ?? r; };
  const card = ((rates.data ?? []) as Array<{ id: string; person_name: string; rate: unknown; notes: string | null; active: boolean }>)
    .map((r) => ({ id: r.id, person_name: r.person_name, rate: Number(r.rate), notes: r.notes, active: r.active }));
  const rateOf = rateIndex(card);
  const costs = lines.map((l) => costLine(l.labourRows, resolve, rateOf));
  const byLine = new Map(lines.map((l, i) => [l, costs[i]] as const));
  const weeks = schedule.weeks.map((w) => totalCosts(w.lines.map((l) => byLine.get(l)!)));
  return { costs, weeks, totals: totalCosts(costs), people: peopleInPeriod(costs), rates: card.filter((r) => r.active) };
}
