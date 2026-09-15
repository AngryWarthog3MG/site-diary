/**
 * Perth calendar windows for the safety figures. "Last N days" counts today as
 * the Nth day, so the window opens N-1 days back; a window opens at Perth
 * midnight, not UTC midnight — the two are eight hours apart, and a report
 * made at 06:30 on the window's first morning falls between them. Perth has
 * no daylight saving, so +08:00 holds all year.
 */

/** The first date in the window, as YYYY-MM-DD, for comparing against `date` columns. */
export function perthWindowDate(today: string, days: number): string {
  return new Date(Date.parse(`${today}T00:00:00Z`) - (days - 1) * 86_400_000).toISOString().slice(0, 10);
}

/** The instant the window opens, as an ISO timestamp, for comparing against `timestamptz` columns. */
export function perthWindowStart(today: string, days: number): string {
  return new Date(Date.parse(`${perthWindowDate(today, days)}T00:00:00+08:00`)).toISOString();
}
