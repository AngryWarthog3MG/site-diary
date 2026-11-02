/**
 * Form schedules (README R181): when a form falls due, counted from when the last one was DONE.
 *
 * The TS twin of `app.form_next_due` — change both together. Pure and dependency-free: dates are ISO calendar
 * days in Perth, nothing here reads a clock. A weekly crack inspection done nine days late is next due a week
 * from the doing, not two weeks from the missed due; a month from the 31st of January is the last day of February,
 * as Postgres has it.
 */

export const UNITS = ['day', 'week', 'month'] as const;
export type Unit = (typeof UNITS)[number];
export const UNIT_LABEL: Record<Unit, string> = { day: 'day', week: 'week', month: 'month' };

export interface ScheduleFacts {
  every: number;
  unit: Unit;
  first_due_on: string;
  active: boolean;
}

/** Overdue, due within three days, further out, or nothing due (retired). */
export type ScheduleState = 'overdue' | 'due_soon' | 'upcoming' | 'none';
export const STATE_LABEL: Record<ScheduleState, string> = { overdue: 'Overdue', due_soon: 'Due', upcoming: 'Upcoming', none: 'Retired' };

/** How many days ahead a form counts as due — tighter than a regulatory obligation's month, because a form is a morning's work. */
export const DUE_SOON_DAYS = 3;

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${String(y).padStart(4, '0')}-${pad(m)}-${pad(d)}`;

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Calendar months, the day clamped to the month's last day. */
export function addMonths(date: string, months: number): string {
  const y = Number(date.slice(0, 4)); const m = Number(date.slice(5, 7)) - 1; const day = Number(date.slice(8, 10));
  const total = m + months;
  const ny = y + Math.floor(total / 12);
  const nm = ((total % 12) + 12) % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return iso(ny, nm + 1, Math.min(day, last));
}

export function addInterval(date: string, every: number, unit: Unit): string {
  if (unit === 'day') return addDays(date, every);
  if (unit === 'week') return addDays(date, every * 7);
  return addMonths(date, every);
}

/** The next due: the first due until one is done, then an interval from the last doing; null once retired. */
export function nextDue(s: ScheduleFacts, lastDoneOn: string | null): string | null {
  if (!s.active) return null;
  if (!lastDoneOn) return s.first_due_on;
  return addInterval(lastDoneOn, s.every, s.unit);
}

export function scheduleState(due: string | null, today: string, soonDays = DUE_SOON_DAYS): ScheduleState {
  if (!due) return 'none';
  if (due < today) return 'overdue';
  if (due <= addDays(today, soonDays)) return 'due_soon';
  return 'upcoming';
}

/**
 * The due days a schedule puts on a calendar between two days inclusive: the next due and every interval after it,
 * as far as the window reaches. An overdue next due before the window is NOT moved into it — the calendar lists
 * overdue ones apart, on the day they fell due.
 */
export function occurrences(s: ScheduleFacts, lastDoneOn: string | null, from: string, to: string, cap = 62): string[] {
  const out: string[] = [];
  let d = nextDue(s, lastDoneOn);
  while (d && d <= to && out.length < cap) {
    if (d >= from) out.push(d);
    d = addInterval(d, s.every, s.unit);
  }
  return out;
}

/** Told tonight when due within three days or overdue, and not already told today. */
export function remindDue(due: string | null, today: string, lastRemindedOn: string | null): boolean {
  if (!due) return false;
  if (lastRemindedOn != null && lastRemindedOn >= today) return false;
  return due <= addDays(today, DUE_SOON_DAYS);
}

/** "every week", "every 2 weeks", "daily", "every 3 months". */
export function describeEvery(every: number, unit: Unit): string {
  if (every === 1) return unit === 'day' ? 'daily' : `every ${unit}`;
  return `every ${every} ${unit}s`;
}
