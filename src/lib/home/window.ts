/**
 * The instant a Perth calendar window opens, as an ISO timestamp for comparing
 * against `timestamptz` columns. "Last 30 days" on a Perth-dated screen starts
 * at Perth midnight, not UTC midnight — the two are eight hours apart, and a
 * report made at 06:30 on the window's first morning falls between them.
 */
export function perthWindowStart(today: string, days: number): string {
  return new Date(Date.parse(`${today}T00:00:00+08:00`) - (days - 1) * 86_400_000).toISOString();
}
