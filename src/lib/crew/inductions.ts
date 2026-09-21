/**
 * Who is inducted onto a job, and who is not (README R88).
 *
 * An induction is by name, per job: the crew roster and the sign-in gate both
 * speak in names, and a subbie or a visitor inducted on the day may have no
 * account at all. Members with accounts are on the job by name too — the name
 * that goes on the sheets (R70) — so the one list here is members and roster
 * together, one entry per person however the name was cased.
 *
 * Pure, relative imports only — node-tested.
 */
import { normaliseName } from './tickets.ts';

export interface Induction {
  person_name: string;
  /** YYYY-MM-DD, the day it happened — not the day it was written up. */
  inducted_on: string;
  notes: string | null;
  /** Whoever recorded it, by name; null when their account has no name yet. */
  recorded_by: string | null;
}

/** Everyone on the job by name, once each, in name order. Blank names are nobody. */
export function peopleOnJob(members: ReadonlyArray<string | null | undefined>, roster: ReadonlyArray<string>): string[] {
  const seen = new Map<string, string>();
  for (const raw of [...members, ...roster]) {
    const name = (raw ?? '').replace(/\s+/g, ' ').trim();
    if (!name) continue;
    const key = normaliseName(name);
    if (!seen.has(key)) seen.set(key, name);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/** This person's induction on the job, if recorded. */
export function inductionFor(list: readonly Induction[], name: string): Induction | null {
  const key = normaliseName(name);
  return list.find((i) => normaliseName(i.person_name) === key) ?? null;
}

/** The people on the job with no induction recorded — the ones the form offers first. */
export function notInducted(people: readonly string[], list: readonly Induction[]): string[] {
  return people.filter((p) => inductionFor(list, p) == null);
}

/** Inducted people first by most recent, then the rest — the order the screen lists them. */
export function inductionRows(people: readonly string[], list: readonly Induction[]): Array<{ name: string; induction: Induction | null }> {
  const named = new Set(people.map(normaliseName));
  // Someone inducted who is on neither the roster nor the member list still counts — a visitor, a subbie.
  const extra = list.filter((i) => !named.has(normaliseName(i.person_name))).map((i) => i.person_name);
  return [...people, ...extra]
    .map((name) => ({ name, induction: inductionFor(list, name) }))
    .sort((a, b) => {
      if (a.induction && b.induction) return b.induction.inducted_on.localeCompare(a.induction.inducted_on) || a.name.localeCompare(b.name);
      if (a.induction) return -1;
      if (b.induction) return 1;
      return a.name.localeCompare(b.name);
    });
}
