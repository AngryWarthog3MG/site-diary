/**
 * Which days the diary expects a record on.
 *
 * Saturday and Sunday are rest days: a weekend with nothing written down is
 * not a hole in the diary and is never nagged about — the screens show it
 * quietly and the knock-off reminder does not fire. A weekend that *was*
 * worked is recorded like any other day and shows exactly as it would on a
 * Tuesday; a rest day is a default, never a bar. The check is on the ISO
 * date alone, in UTC, so a Perth evening cannot turn Friday into Saturday.
 */
export function isRestDay(isoDate: string): boolean {
  const dow = new Date(`${isoDate}T00:00:00Z`).getUTCDay();
  return dow === 0 || dow === 6;
}
