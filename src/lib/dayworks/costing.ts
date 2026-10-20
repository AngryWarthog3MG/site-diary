// Relative on purpose: node-tested, and nothing here may drag a runtime client in.
import type { LabourRow } from '../pdf/labour-rows.ts';

/**
 * What a daywork costs, person by person (README R158): each person's hours on the item (R129) at the company's rate
 * for that NAME. Pure. The rules are the schedule's own: a figure is added only where it is known. A person with no
 * hours, or no rate, leaves the item's amount blank and says which — never a share, never a nought — and an item with
 * no labour rows (the words as said, nobody picked) cannot be costed at all, and says so.
 */

export interface PersonRate { person_name: string; rate: number; active?: boolean }

export interface CostedPerson {
  /** The name as it stands on the signed row. */
  name: string;
  /** The person it resolves to on the company's list (a rename, an alias) — the name the rate is kept under. */
  person: string;
  hours: number | null;
  rate: number | null;
  /** hours × rate to the cent, or null while either is missing. */
  amount: number | null;
}

export interface LineCost {
  people: CostedPerson[];
  /** The item's amount: the sum of its people's, only when every one of them has one. */
  amount: number | null;
  /** Why there is no amount, in the schedule's words — empty when there is one. */
  missingRate: string[];
  missingHours: string[];
  /** The item names nobody on a row: the labour is text alone and cannot be priced by person. */
  noRows: boolean;
}

export interface CostTotals {
  /** Amounts added over the items that have one. */
  amount: number;
  costed: number;
  notCosted: number;
}

export const normName = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** The live rate for a name, ignoring case and spacing; null when the company has none for them. */
export function rateIndex(rates: readonly PersonRate[]): (person: string) => number | null {
  const live = new Map<string, number>();
  for (const r of rates) if (r.active !== false && Number.isFinite(r.rate)) live.set(normName(r.person_name), r.rate);
  return (person) => live.get(normName(person)) ?? null;
}

export function costLine(rows: readonly LabourRow[], resolve: (name: string) => string, rateOf: (person: string) => number | null): LineCost {
  if (rows.length === 0) return { people: [], amount: null, missingRate: [], missingHours: [], noRows: true };
  const people: CostedPerson[] = rows.map((r) => {
    const person = resolve(r.person_name);
    const rate = rateOf(person);
    const hours = r.hours;
    return { name: r.person_name, person, hours, rate, amount: hours != null && rate != null ? round2(hours * rate) : null };
  });
  const missingRate = [...new Set(people.filter((p) => p.rate == null).map((p) => p.person))];
  const missingHours = people.filter((p) => p.hours == null).map((p) => p.person);
  const complete = people.every((p) => p.amount != null);
  return {
    people,
    amount: complete ? round2(people.reduce((t, p) => t + (p.amount ?? 0), 0)) : null,
    missingRate,
    missingHours,
    noRows: false,
  };
}

export function totalCosts(costs: readonly LineCost[]): CostTotals {
  let amount = 0; let costed = 0; let notCosted = 0;
  for (const c of costs) {
    if (c.amount == null) { notCosted += 1; continue; }
    costed += 1; amount = round2(amount + c.amount);
  }
  return { amount, costed, notCosted };
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

/** Dollars the way the app prints them, without reaching into the money module from a leaf. */
export function fmtAmount(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const cents = Math.round(n * 100);
  const whole = cents % 100 === 0;
  return `$${(cents / 100).toLocaleString('en-AU', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })}`;
}
