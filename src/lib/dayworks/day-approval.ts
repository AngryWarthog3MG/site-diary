/**
 * The head contractor signs for a day's dayworks on that day's diary (README R192).
 *
 * The signature is the same record as one given on the Dayworks schedule (R125): a `dayworks_signoffs` row holding
 * the LINES it was given for. So the day's items have to be read here exactly as the schedule reads the saved rows —
 * the works as described, and the hours as the database keeps them: the people's hours added up when every person
 * has theirs, else the hours typed (README R129). Read any other way, a line signed on the diary would not match
 * itself on the schedule and would sit there "awaiting approval" with a signature behind it.
 *
 * Pure, relative imports only — node-tested.
 */
import { labourRowsText, labourRowsTotal, readLabourRows } from '../pdf/labour-rows.ts';
import { snapshotLines, type SignedLine } from './signoff.ts';

/** A daywork as the review screen holds it — every field as loose as the payload's. */
export interface DayworkDraft {
  description?: unknown;
  hours?: unknown;
  labour?: unknown;
  labour_rows?: unknown;
  plant?: unknown;
  materials?: unknown;
  docket_ref?: unknown;
}

const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** The hours the database will keep for this item: the people's sum when every one has theirs, else the typed figure. */
export function dayworkHours(item: DayworkDraft): number | null {
  return labourRowsTotal(readLabourRows(item.labour_rows)) ?? num(item.hours);
}

/** The day's dayworks as a signature holds them. Items with no description are left out — there is nothing to sign for. */
export function dayLines(entryDate: string, items: readonly DayworkDraft[]): SignedLine[] {
  return snapshotLines(
    items.filter((it) => text(it.description)).map((it) => ({
      date: entryDate,
      works: text(it.description) as string,
      hours: dayworkHours(it),
      docket: text(it.docket_ref),
      labour: labourRowsText(readLabourRows(it.labour_rows)) ?? text(it.labour),
      plant: text(it.plant),
      materials: text(it.materials),
    })),
  );
}

/**
 * What is still to be filled in before anyone is asked to sign, item by item. Empty means the tab is filled in:
 * every item says what was done and for how many hours, and nobody on it is without theirs.
 */
export function dayBlockers(items: readonly DayworkDraft[]): string[] {
  const out: string[] = [];
  items.forEach((it, i) => {
    const n = `Item ${i + 1}`;
    if (!text(it.description)) { out.push(`${n} has no description.`); return; }
    const without = readLabourRows(it.labour_rows).filter((r) => r.hours == null).map((r) => r.person_name);
    if (without.length) out.push(`${n}: ${without.join(', ')} ${without.length === 1 ? 'has' : 'have'} no hours.`);
    else if (dayworkHours(it) == null) out.push(`${n} has no hours.`);
  });
  return out;
}

/** How a sign-off given on the day's diary names what it covers. */
export function dayPeriodLabel(entryDate: string): string {
  return `${entryDate.slice(8, 10)}/${entryDate.slice(5, 7)}/${entryDate.slice(0, 4)} — signed on the day's diary`;
}
