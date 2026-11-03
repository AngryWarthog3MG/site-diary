/** The report's default window: the twelve months to today (README R188). Pure. */
export function defaultPeriod(today: string): { from: string; to: string } {
  const y = Number(today.slice(0, 4)) - 1;
  const rest = today.slice(4);
  // 29 Feb a year back is 28 Feb.
  const from = rest === '-02-29' ? `${y}-02-28` : `${y}${rest}`;
  return { from, to: today };
}
