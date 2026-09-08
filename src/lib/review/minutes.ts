/**
 * Delay minutes from the times a supervisor stated.
 *
 * The model is told never to compute a duration — "stood down from ten thirty
 * till half twelve" must come back as two times and a null, because a number
 * nobody said is an invention. But once both times are on the review screen,
 * the minutes between them are arithmetic, not invention: the same sum the
 * screen already does when the supervisor edits a time. Without this fill a
 * delay spoken as a span printed "—" in the Mins column and counted zero in the
 * docket's total and in the weekly a PM reads — an EOT delay quietly worth
 * nothing. The supervisor still sees and confirms the figure before it is
 * stored; a duration they stated is never overwritten.
 */
export function minutesBetween(
  start: string | null | undefined,
  end: string | null | undefined,
): number | null {
  if (!start || !end) return null;
  const parse = (value: string) => {
    const m = /^(\d{1,2}):(\d{2})/.exec(value);
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  const from = parse(start);
  const to = parse(end);
  if (from == null || to == null) return null;
  let span = to - from;
  if (span <= 0) span += 24 * 60; // past midnight
  return span > 0 ? span : null;
}

type DelayLike = {
  start_time?: string | null;
  end_time?: string | null;
  duration_mins?: number | null;
};

/** Fill `duration_mins` from stated times where the model correctly left it null. */
export function fillDelayMinutes<T extends DelayLike>(rows: T[]): T[] {
  return rows.map((row) => {
    if (row.duration_mins != null) return row;
    const mins = minutesBetween(row.start_time, row.end_time);
    return mins == null ? row : { ...row, duration_mins: mins };
  });
}
