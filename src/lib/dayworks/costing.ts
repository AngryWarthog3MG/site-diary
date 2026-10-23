// Relative on purpose: node-tested, and nothing here may drag a runtime client in.
import type { LabourRow } from '../pdf/labour-rows.ts';

/**
 * What a daywork costs, person by person and machine by machine (README R158, R159): each person's hours on the
 * item at the company's rate for that NAME, and each machine's hours at the rate card's rate for that MACHINE.
 * Pure. The rules are the schedule's own: a figure is added only where it is known. A person or machine with no
 * hours, or no rate, leaves the item's amount blank and says which — never a share, never a nought.
 *
 * Where the people come from: the signed row's own labour rows (R129) when it has them — the record wins — else the
 * office's costing allocation (R159), picked on the Dayworks screen. The machines always come from the allocation:
 * a daywork's plant is words on the day.
 */

export interface PersonRate { person_name: string; rate: number; active?: boolean }
/** A machine rate off the rate card (R104): by the machine itself, else by its name. */
export interface PlantRate { plant_id: string | null; label: string; rate: number }
export interface PlantRow { plant_id: string | null; name: string; hours: number | null }

export interface CostedPerson {
  /** The name as it stands on the row. */
  name: string;
  /** The person it resolves to on the company's list (a rename, an alias) — the name the rate is kept under. */
  person: string;
  hours: number | null;
  rate: number | null;
  /** hours × rate to the cent, or null while either is missing. */
  amount: number | null;
}

export interface CostedMachine {
  name: string;
  plant_id: string | null;
  hours: number | null;
  rate: number | null;
  amount: number | null;
}

export interface LineCost {
  people: CostedPerson[];
  /** Where the people came from: the signed row, the office's allocation, or nowhere yet. */
  labourFrom: 'record' | 'allocation' | 'none';
  machines: CostedMachine[];
  labourAmount: number | null;
  plantAmount: number | null;
  /** The item's amount: labour plus plant, only when every person and machine on it has one. */
  amount: number | null;
  /** Why there is no amount, in the schedule's words — empty when there is one. */
  missingRate: string[];
  missingHours: string[];
  missingPlantRate: string[];
  missingPlantHours: string[];
  /** The item names nobody, on the row or in the allocation: the labour cannot be priced by person. */
  noRows: boolean;
  /** The day recorded plant in words and no machine has been picked for it: the amount is labour alone. */
  plantNotCosted: boolean;
  /** Left out of the claim by the office (R160): costed for the record, carried by no total. */
  excluded: boolean;
  excludedReason: string | null;
  /** The materials on the item as the office typed them, ex GST (R170); null is no figure. In `amount` when the item has one. */
  materialsAmount: number | null;
  materialsNote: string | null;
}

export interface CostTotals {
  /** Amounts added over the items that have one. */
  amount: number;
  costed: number;
  notCosted: number;
  /** Items whose amount leaves out plant the day recorded. */
  plantNotCosted: number;
  /** Items left out of the claim: in none of the other counts. */
  excluded: number;
  /** The materials figures inside `amount`, so a total can say how much of it was typed (R170). */
  materials: number;
}

export const normName = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** The live rate for a name, ignoring case and spacing; null when the company has none for them. */
export function rateIndex(rates: readonly PersonRate[]): (person: string) => number | null {
  const live = new Map<string, number>();
  for (const r of rates) if (r.active !== false && Number.isFinite(r.rate)) live.set(normName(r.person_name), r.rate);
  return (person) => live.get(normName(person)) ?? null;
}

/** The rate for a machine: the rate that names that machine, else one whose name is the machine's. */
export function plantRateIndex(rates: readonly PlantRate[]): (m: Pick<PlantRow, 'plant_id' | 'name'>) => number | null {
  const byId = new Map<string, number>();
  const byName = new Map<string, number>();
  for (const r of rates) {
    if (!Number.isFinite(r.rate)) continue;
    if (r.plant_id) byId.set(r.plant_id, r.rate);
    if (!byName.has(normName(r.label))) byName.set(normName(r.label), r.rate);
  }
  return (m) => (m.plant_id ? byId.get(m.plant_id) : undefined) ?? byName.get(normName(m.name)) ?? null;
}

export interface CostLineInput {
  /** The signed row's own people (R129). */
  rows: readonly LabourRow[];
  /** The office's people for a row that names nobody (R159). Ignored when the row has its own. */
  allocatedLabour?: readonly LabourRow[];
  /** The office's machines (R159). */
  plant?: readonly PlantRow[];
  /** The day's plant as words, so an item with plant and no machines picked can say so. */
  plantText?: string | null;
  /** Left out of the claim by the office (R160). */
  excluded?: boolean;
  excludedReason?: string | null;
  /** The materials figure the office typed, ex GST (R170). */
  materialsAmount?: number | null;
  materialsNote?: string | null;
}

export function costLine(
  input: CostLineInput,
  resolve: (name: string) => string,
  rateOf: (person: string) => number | null,
  plantRateOf: (m: Pick<PlantRow, 'plant_id' | 'name'>) => number | null = () => null,
): LineCost {
  const labourFrom: LineCost['labourFrom'] = input.rows.length > 0 ? 'record' : (input.allocatedLabour?.length ?? 0) > 0 ? 'allocation' : 'none';
  const rows = labourFrom === 'record' ? input.rows : labourFrom === 'allocation' ? input.allocatedLabour! : [];
  const people: CostedPerson[] = rows.map((r) => {
    const person = resolve(r.person_name);
    const rate = rateOf(person);
    const hours = r.hours;
    return { name: r.person_name, person, hours, rate, amount: hours != null && rate != null ? round2(hours * rate) : null };
  });
  const machines: CostedMachine[] = (input.plant ?? []).map((m) => {
    const rate = plantRateOf(m);
    return { name: m.name, plant_id: m.plant_id, hours: m.hours, rate, amount: m.hours != null && rate != null ? round2(m.hours * rate) : null };
  });
  const noRows = people.length === 0;
  const labourComplete = !noRows && people.every((p) => p.amount != null);
  const plantComplete = machines.every((m) => m.amount != null);
  const labourAmount = labourComplete ? round2(people.reduce((t, p) => t + (p.amount ?? 0), 0)) : null;
  const plantAmount = machines.length && plantComplete ? round2(machines.reduce((t, m) => t + (m.amount ?? 0), 0)) : machines.length ? null : 0;
  const materialsAmount = input.materialsAmount != null && Number.isFinite(input.materialsAmount) ? round2(input.materialsAmount) : null;
  // Materials ride on an item that is otherwise costed: a figure typed on an item whose people cannot be priced is shown, not totalled.
  const amount = labourAmount != null && plantAmount != null ? round2(labourAmount + plantAmount + (materialsAmount ?? 0)) : null;
  return {
    people,
    labourFrom,
    machines,
    labourAmount,
    plantAmount: machines.length ? plantAmount : null,
    amount,
    missingRate: [...new Set(people.filter((p) => p.rate == null).map((p) => p.person))],
    missingHours: people.filter((p) => p.hours == null).map((p) => p.person),
    missingPlantRate: [...new Set(machines.filter((m) => m.rate == null).map((m) => m.name))],
    missingPlantHours: machines.filter((m) => m.hours == null).map((m) => m.name),
    noRows,
    plantNotCosted: machines.length === 0 && Boolean((input.plantText ?? '').trim()),
    excluded: Boolean(input.excluded),
    excludedReason: input.excluded ? (input.excludedReason?.trim() || null) : null,
    materialsAmount,
    materialsNote: materialsAmount != null ? (input.materialsNote?.trim() || null) : null,
  };
}

export function totalCosts(costs: readonly LineCost[]): CostTotals {
  let amount = 0; let costed = 0; let notCosted = 0; let plantNotCosted = 0; let excluded = 0; let materials = 0;
  for (const c of costs) {
    if (c.excluded) { excluded += 1; continue; }
    if (c.plantNotCosted) plantNotCosted += 1;
    if (c.amount == null) { notCosted += 1; continue; }
    costed += 1; amount = round2(amount + c.amount); materials = round2(materials + (c.materialsAmount ?? 0));
  }
  return { amount, costed, notCosted, plantNotCosted, excluded, materials };
}

/** One line's reason for having no amount, in the schedule's words; empty when it has one. */
export function whyNoAmount(c: LineCost): string {
  if (c.excluded) return 'Left out of the claim';
  if (c.amount != null) return '';
  if (c.noRows) return c.materialsAmount != null ? `People not on the row · materials ${fmtAmount(c.materialsAmount)} typed, not counted until the item is costed` : 'People not on the row';
  const parts: string[] = [];
  if (c.missingRate.length) parts.push(`No rate: ${c.missingRate.join(', ')}`);
  if (c.missingHours.length) parts.push(`Hours not recorded: ${c.missingHours.join(', ')}`);
  if (c.missingPlantRate.length) parts.push(`No plant rate: ${c.missingPlantRate.join(', ')}`);
  if (c.missingPlantHours.length) parts.push(`Plant hours missing: ${c.missingPlantHours.join(', ')}`);
  if (c.materialsAmount != null) parts.push(`materials ${fmtAmount(c.materialsAmount)} typed, not counted until the item is costed`);
  return parts.join(' · ');
}

export interface PersonInPeriod {
  person: string;
  rate: number | null;
  /** Their recorded hours over the period's items — added where known, the rest counted. */
  hours: number;
  hoursNotRecorded: number;
  items: number;
}

/** Everyone named on the period's items, with their rate and hours, so the rates block lists exactly who it needs to. */
export function peopleInPeriod(costs: readonly LineCost[]): PersonInPeriod[] {
  const by = new Map<string, PersonInPeriod>();
  for (const c of costs) {
    if (c.excluded) continue;
    const seen = new Set<string>();
    for (const p of c.people) {
      const key = normName(p.person);
      const row = by.get(key) ?? { person: p.person, rate: p.rate, hours: 0, hoursNotRecorded: 0, items: 0 };
      if (p.hours == null) row.hoursNotRecorded += 1; else row.hours = round2(row.hours + p.hours);
      if (!seen.has(key)) { row.items += 1; seen.add(key); }
      by.set(key, row);
    }
  }
  return [...by.values()].sort((a, b) => a.person.localeCompare(b.person));
}

export interface MachineInPeriod {
  name: string;
  plant_id: string | null;
  rate: number | null;
  hours: number;
  hoursNotRecorded: number;
  items: number;
}

/** Every machine picked on the period's items, with its rate and hours. Keyed by the register machine, else its name. */
export function machinesInPeriod(costs: readonly LineCost[]): MachineInPeriod[] {
  const by = new Map<string, MachineInPeriod>();
  for (const c of costs) {
    if (c.excluded) continue;
    const seen = new Set<string>();
    for (const m of c.machines) {
      const key = m.plant_id ?? `name:${normName(m.name)}`;
      const row = by.get(key) ?? { name: m.name, plant_id: m.plant_id, rate: m.rate, hours: 0, hoursNotRecorded: 0, items: 0 };
      if (m.hours == null) row.hoursNotRecorded += 1; else row.hours = round2(row.hours + m.hours);
      if (!seen.has(key)) { row.items += 1; seen.add(key); }
      by.set(key, row);
    }
  }
  return [...by.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Dollars the way the app prints them, without reaching into the money module from a leaf. */
export function fmtAmount(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const cents = Math.round(n * 100);
  const whole = cents % 100 === 0;
  return `$${(cents / 100).toLocaleString('en-AU', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })}`;
}

/** The allocation rows as the database keeps them, read back without trusting the shape. */
export function readPlantRows(value: unknown): PlantRow[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => {
      const o = (v ?? {}) as { plant_id?: unknown; name?: unknown; hours?: unknown };
      const name = typeof o.name === 'string' ? o.name.trim() : '';
      const h = o.hours == null || o.hours === '' ? null : Number(o.hours);
      return { plant_id: typeof o.plant_id === 'string' && o.plant_id ? o.plant_id : null, name, hours: h != null && Number.isFinite(h) ? h : null };
    })
    .filter((r) => r.name !== '');
}

/** An allocation whose daywork row is no longer the day's current version (README R163). */
export interface OrphanAllocation<T> { date: string; works: string; allocation: T }

/**
 * A correction of a day mints new daywork rows, so an allocation keyed to the old row would vanish with it — and
 * with it the office's decision to leave an item out of the claim. Carry it: a current line with no allocation of
 * its own takes the one left on a superseded version of the same day with the same works, when there is exactly one.
 * Two candidates is ambiguity, and ambiguity is a blank, never a guess.
 */
export function carryAllocations<T>(
  lines: ReadonlyArray<{ date: string; works: string; dayworkId: string | null }>,
  own: ReadonlySet<string>,
  orphans: ReadonlyArray<OrphanAllocation<T>>,
): Map<string, T> {
  const byKey = new Map<string, T[]>();
  for (const o of orphans) {
    const k = `${o.date}|${normName(o.works)}`;
    byKey.set(k, [...(byKey.get(k) ?? []), o.allocation]);
  }
  const out = new Map<string, T>();
  for (const l of lines) {
    if (!l.dayworkId || own.has(l.dayworkId)) continue;
    const found = byKey.get(`${l.date}|${normName(l.works)}`);
    if (found && found.length === 1) out.set(l.dayworkId, found[0]);
  }
  return out;
}
