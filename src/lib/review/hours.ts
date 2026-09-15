/**
 * Worked hours from the clock: span minus break, rolling past midnight when
 * the finish reads earlier. Mirrors the computation apply_entry_review does
 * at save time, so what the supervisor sees is what the record stores.
 * Relative imports only — the gate's labour helper is Node-tested.
 */
export function workedHours(
  start: string | null | undefined,
  finish: string | null | undefined,
  breakMins: number | null | undefined,
): number | null {
  if (!start || !finish) return null;
  const parse = (value: string) => {
    const m = /^(\d{1,2}):(\d{2})/.exec(value);
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  const from = parse(start);
  const to = parse(finish);
  if (from == null || to == null) return null;
  let span = to - from;
  if (span <= 0) span += 24 * 60;
  const net = (span - (breakMins ?? 0)) / 60;
  return net > 0 ? Math.round(net * 100) / 100 : null;
}
