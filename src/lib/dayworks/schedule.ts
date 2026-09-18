/**
 * The dayworks schedule: every daywork on signed days, the works completed
 * under each, week by week, with the hours totalled. Pure, relative imports
 * only — node-tested.
 *
 * Hours are totalled only where the supervisor recorded them. A daywork with
 * no hours is counted and flagged "hours not recorded", never added as zero —
 * a total that quietly counted a blank as nothing would be inventing a number.
 */

export interface DayworkLine {
  date: string;
  entryNo: string;
  entryId: string | null;
  /** The daywork row itself, for pulling its photographs onto the sign-off sheet. */
  dayworkId: string | null;
  works: string;
  labour: string | null;
  plant: string | null;
  materials: string | null;
  hours: number | null;
  /** The docket as recorded on the day, or added afterwards from Claims. */
  docket: string | null;
  docketAddedOn: string | null;
}

export interface ScheduleWeek {
  /** Monday. */
  start: string;
  /** Sunday. */
  end: string;
  lines: DayworkLine[];
  hours: number;
  hoursNotRecorded: number;
}

export interface ScheduleTotals {
  /** Dayworks, i.e. items of work completed under daywork. */
  items: number;
  days: number;
  hours: number;
  hoursNotRecorded: number;
  docketed: number;
  toChase: number;
}

export interface DayworksSchedule {
  from: string | null;
  to: string | null;
  weeks: ScheduleWeek[];
  totals: ScheduleTotals;
}

export type RangeKey = 'all' | 'week' | 'month' | 'last-month' | 'custom';

export interface Range {
  key: RangeKey;
  from: string | null;
  to: string | null;
  label: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const round2 = (n: number) => Math.round(n * 100) / 100;

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The Monday of the week a date falls in. */
export function weekStart(date: string): string {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 Sunday
  return addDays(date, dow === 0 ? -6 : 1 - dow);
}

const isDate = (v: unknown): v is string => typeof v === 'string' && DATE_RE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** The period asked for in the address, against Perth's today. Anything unreadable is the whole job. */
export function readRange(params: { range?: string; from?: string; to?: string }, today: string): Range {
  switch (params.range) {
    case 'week': {
      const from = weekStart(today);
      return { key: 'week', from, to: addDays(from, 6), label: `Week of ${dm(from)}` };
    }
    case 'month': {
      const from = `${today.slice(0, 7)}-01`;
      const to = addDays(`${nextMonth(today.slice(0, 7))}-01`, -1);
      return { key: 'month', from, to, label: monthLabel(today.slice(0, 7)) };
    }
    case 'last-month': {
      const month = prevMonth(today.slice(0, 7));
      return { key: 'last-month', from: `${month}-01`, to: addDays(`${today.slice(0, 7)}-01`, -1), label: monthLabel(month) };
    }
    case 'custom': {
      let from = isDate(params.from) ? params.from : null;
      let to = isDate(params.to) ? params.to : null;
      if (from && to && from > to) [from, to] = [to, from];
      if (!from && !to) break;
      return { key: 'custom', from, to, label: from && to ? `${dm(from)} to ${dm(to)}` : from ? `From ${dm(from)}` : `To ${dm(to!)}` };
    }
  }
  return { key: 'all', from: null, to: null, label: 'Whole job' };
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function monthLabel(month: string): string { return `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`; }
function nextMonth(month: string): string { const [y, m] = month.split('-').map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; }
function prevMonth(month: string): string { const [y, m] = month.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; }

/** Lines in date order, grouped by week, with each week's and the whole period's totals. */
export function buildSchedule(lines: readonly DayworkLine[], range: Pick<Range, 'from' | 'to'>): DayworksSchedule {
  const inRange = lines
    .filter((l) => (!range.from || l.date >= range.from) && (!range.to || l.date <= range.to))
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date) || a.entryNo.localeCompare(b.entryNo) || a.works.localeCompare(b.works));

  const weeks: ScheduleWeek[] = [];
  for (const line of inRange) {
    const start = weekStart(line.date);
    let week = weeks[weeks.length - 1];
    if (!week || week.start !== start) {
      week = { start, end: addDays(start, 6), lines: [], hours: 0, hoursNotRecorded: 0 };
      weeks.push(week);
    }
    week.lines.push(line);
    if (line.hours == null) week.hoursNotRecorded += 1; else week.hours = round2(week.hours + line.hours);
  }

  return {
    from: range.from,
    to: range.to,
    weeks,
    totals: {
      items: inRange.length,
      days: new Set(inRange.map((l) => l.date)).size,
      hours: round2(inRange.reduce((sum, l) => sum + (l.hours ?? 0), 0)),
      hoursNotRecorded: inRange.filter((l) => l.hours == null).length,
      docketed: inRange.filter((l) => l.docket).length,
      toChase: inRange.filter((l) => !l.docket).length,
    },
  };
}

/**
 * Every line in schedule order, week by week. The item number a sign-off
 * sheet prints beside a row is its place in this list, so the schedule and
 * the photographs agree on which item is which.
 */
export function scheduleLines(s: DayworksSchedule): DayworkLine[] {
  return s.weeks.flatMap((w) => w.lines);
}
