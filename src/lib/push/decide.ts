/**
 * Whether a knock-off reminder should go to one subscription, decided from
 * facts alone so it can be tested without a clock or a database.
 *
 * The rules: site days are Monday to Friday; a person who already has an
 * entry for today needs no nudge; one nudge a day is the cap, whatever
 * schedules or retries fire.
 */

/** ISO date → 0..6 (Sunday..Saturday), computed in UTC. */
export function dayOfWeek(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

export function shouldRemind(input: {
  perthToday: string;
  hasEntryToday: boolean;
  lastNotifiedOn: string | null;
}): boolean {
  const dow = dayOfWeek(input.perthToday);
  if (dow === 0 || dow === 6) return false;
  if (input.hasEntryToday) return false;
  if (input.lastNotifiedOn === input.perthToday) return false;
  return true;
}

/** Today's date on site, whatever the server's clock zone. */
export function perthToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Perth' }).format(now);
}
