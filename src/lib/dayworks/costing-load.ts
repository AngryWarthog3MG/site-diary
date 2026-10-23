import type { SupabaseClient } from '@supabase/supabase-js';
import { makeResolver } from '@/lib/timesheets/model';
import { cardFor, type CostKind, type RateItem } from '@/lib/variations/costs';
import { readLabourRows, type LabourRow } from '@/lib/pdf/labour-rows';
import {
  carryAllocations, costLine, machinesInPeriod, normName, peopleInPeriod, plantRateIndex, rateIndex, readPlantRows, totalCosts,
  type CostTotals, type LineCost, type MachineInPeriod, type PersonInPeriod, type PersonRate, type PlantRate, type PlantRow,
} from './costing';
import type { DayworkLine, DayworksSchedule } from './schedule';

/** The office's allocation for one daywork (README R159), as kept. */
export interface DayworkAllocation {
  id: string; dayworkId: string; labour: LabourRow[]; plant: PlantRow[]; note: string | null; excluded: boolean; excludedReason: string | null;
  /** The materials figure typed, ex GST (README R170). */
  materialsAmount: number | null; materialsNote: string | null;
  /** Carried from a superseded version of the day (README R163): the row it was kept on; saving keeps it on the new one. */
  carriedFrom: string | null;
}

export interface DayworksCosting {
  /** Beside each line given, in the same order. */
  costs: LineCost[];
  /** Per week, in the schedule's order. */
  weeks: CostTotals[];
  totals: CostTotals;
  people: PersonInPeriod[];
  machines: MachineInPeriod[];
  /** The company's live rates by person, for the block that sets them. */
  rates: Array<PersonRate & { id: string; notes: string | null }>;
  /** The rate card's machine rates that apply on this job (R104). */
  plantRates: Array<PlantRate & { id: string; scope: 'job' | 'company' }>;
  /** By daywork id: what the office has picked for it. */
  allocations: Record<string, DayworkAllocation>;
  /** Whether the rates were read: false when the caller does not see the money, so every amount is blank. */
  money: boolean;
}

/**
 * The period's items costed by person and by machine (README R158, R159), under the caller's RLS. The allocations
 * come back for a register keeper; the rates only for someone who sees the money with their code entered (the page
 * says which, `money`) — anyone else gets the people and machines with no dollar beside them. Names on the signed
 * rows are resolved the way the timesheet resolves them (R107) and spelt as the staff list spells them (R123), so a
 * row signed as "Matty Rogers" costs at Matthew Rodgers' rate.
 */
export async function loadDayworksCosting(
  supabase: SupabaseClient, orgId: string, projectId: string, schedule: DayworksSchedule, lines: readonly DayworkLine[], options: { money: boolean },
): Promise<DayworksCosting> {
  const dayworkIds = lines.map((l) => l.dayworkId).filter((id): id is string => Boolean(id));
  const [rates, plantRates, crew, aliases, staff, allocationRows, everyAllocation] = await Promise.all([
    options.money ? supabase.from('person_rates').select('id, person_name, rate, notes, active').eq('org_id', orgId) : Promise.resolve({ data: [], error: null }),
    options.money
      ? supabase.from('rate_items').select('id, org_id, project_id, kind, label, plant_id, unit, rate, notes, active').eq('org_id', orgId).eq('kind', 'plant').or(`project_id.is.null,project_id.eq.${projectId}`)
      : Promise.resolve({ data: [], error: null }),
    supabase.from('crew').select('project_id, name, aliases').eq('project_id', projectId),
    supabase.from('person_aliases').select('alias, name').eq('org_id', orgId),
    supabase.from('staff').select('name').eq('org_id', orgId),
    dayworkIds.length ? supabase.from('daywork_costings').select('id, daywork_id, labour, plant, note, excluded, excluded_reason, materials_amount, materials_note').in('daywork_id', dayworkIds) : Promise.resolve({ data: [], error: null }),
    // Every allocation on this job whose daywork is not on the schedule: a corrected day's old rows (README R163).
    supabase.from('daywork_costings').select('id, daywork_id, labour, plant, note, excluded, excluded_reason, materials_amount, materials_note, daywork:dayworks!inner(description, entry:entries!inner(entry_date))').eq('project_id', projectId),
  ]);
  for (const r of [rates, plantRates, crew, aliases, staff, allocationRows, everyAllocation]) if (r.error) throw new Error(r.error.message);
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
  // The machine rates that apply here: the job's own over the company's of the same name (R104).
  const items: RateItem[] = ((plantRates.data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id), org_id: String(r.org_id), project_id: (r.project_id as string | null) ?? null, kind: r.kind as CostKind,
    label: String(r.label), plant_id: (r.plant_id as string | null) ?? null, unit: String(r.unit), rate: Number(r.rate),
    notes: (r.notes as string | null) ?? null, active: Boolean(r.active),
  }));
  const plantCard = cardFor(items, projectId).filter((r) => r.kind === 'plant' && r.unit === 'hour')
    .map((r) => ({ id: r.id, plant_id: r.plant_id, label: r.label, rate: r.rate, scope: r.scope }));
  const plantRateOf = plantRateIndex(plantCard);

  const allocations: Record<string, DayworkAllocation> = {};
  type Raw = { id: string; daywork_id: string; labour: unknown; plant: unknown; note: string | null; excluded: boolean | null; excluded_reason: string | null; materials_amount: unknown; materials_note: string | null };
  const money = (v: unknown) => { if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
  const read = (a: Raw, carriedFrom: string | null): DayworkAllocation => ({ id: a.id, dayworkId: a.daywork_id, labour: readLabourRows(a.labour), plant: readPlantRows(a.plant), note: a.note, excluded: Boolean(a.excluded), excludedReason: a.excluded_reason, materialsAmount: money(a.materials_amount), materialsNote: a.materials_note, carriedFrom });
  for (const a of (allocationRows.data ?? []) as Raw[]) allocations[a.daywork_id] = read(a, null);
  // A corrected day's rows are new, so an allocation kept on the old row would vanish — and the decision to leave an
  // item out of the claim with it. The one left on the same day and works carries to the new row (README R163).
  const current = new Set(dayworkIds);
  type Embedded = { description: string; entry: { entry_date: string } | Array<{ entry_date: string }> };
  const orphans: Array<{ date: string; works: string; allocation: Raw }> = [];
  for (const a of (everyAllocation.data ?? []) as Array<Raw & { daywork: Embedded | Embedded[] | null }>) {
    if (current.has(a.daywork_id)) continue;
    const d = Array.isArray(a.daywork) ? a.daywork[0] : a.daywork;
    const e = d ? (Array.isArray(d.entry) ? d.entry[0] : d.entry) : null;
    if (d && e) orphans.push({ date: String(e.entry_date), works: String(d.description ?? ''), allocation: a });
  }
  for (const [dayworkId, a] of carryAllocations(lines, new Set(Object.keys(allocations)), orphans)) allocations[dayworkId] = read(a, a.daywork_id);
  const costs = lines.map((l) => {
    const a = l.dayworkId ? allocations[l.dayworkId] : undefined;
    return costLine({ rows: l.labourRows, allocatedLabour: a?.labour, plant: a?.plant, plantText: l.plant, excluded: a?.excluded, excludedReason: a?.excludedReason, materialsAmount: a?.materialsAmount, materialsNote: a?.materialsNote }, resolve, rateOf, plantRateOf);
  });
  const byLine = new Map(lines.map((l, i) => [l, costs[i]] as const));
  const weeks = schedule.weeks.map((w) => totalCosts(w.lines.map((l) => byLine.get(l)!)));
  return {
    costs, weeks, totals: totalCosts(costs), people: peopleInPeriod(costs), machines: machinesInPeriod(costs),
    rates: card.filter((r) => r.active), plantRates: plantCard, allocations, money: options.money,
  };
}
