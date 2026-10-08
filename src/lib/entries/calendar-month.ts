/**
 * The diary as a month (README R131): one tile per day, coloured by what the record holds for it. Pure, relative
 * imports only — node-tested. The states are the register's own: a signed day, an open draft, a draft handed over
 * for sign-off, an unsigned correction on a signed day, a working day with nothing (a hole), a rest day, and days
 * not yet come or before the job began.
 */
import { isRestDay } from '../calendar.ts';

export interface CalendarRow {
  id: string;
  entry_date: string;
  status: string;
  correction: boolean;
  supersedes: string | null;
  ready?: boolean;
  entry_no?: string | null;
}

export type DayState = 'signed' | 'draft' | 'ready' | 'correction' | 'gap' | 'rest' | 'future' | 'before';

export interface DayTile {
  date: string;
  state: DayState;
  /** The entry to open for the day: the open draft or correction first, else the signed day. */
  entryId: string | null;
  entryNo: string | null;
  inMonth: boolean;
  today: boolean;
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export const monthOf = (date: string) => date.slice(0, 7);
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export function monthLabel(month: string): string { return `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`; }
export function nextMonth(month: string): string { const [y, m] = month.split('-').map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; }
export function prevMonth(month: string): string { const [y, m] = month.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; }
function monthEnd(month: string): string { return addDays(`${nextMonth(month)}-01`, -1); }
function weekStart(date: string): string { const dow = new Date(`${date}T00:00:00Z`).getUTCDay(); return addDays(date, dow === 0 ? -6 : 1 - dow); }

/** What the record holds for one day. The current version of a signed day wins over its replaced versions. */
export function dayState(rowsForDay: readonly CalendarRow[], date: string, today: string, oldest: string | null): { state: DayState; entryId: string | null; entryNo: string | null } {
  const replaced = new Set(rowsForDay.filter((r) => r.status === 'signed' && r.supersedes).map((r) => r.supersedes as string));
  const live = rowsForDay.filter((r) => !replaced.has(r.id));
  const drafts = live.filter((r) => r.status !== 'signed');
  const signed = live.filter((r) => r.status === 'signed');
  if (drafts.length > 0) {
    const d = drafts[0];
    const state: DayState = signed.length > 0 || d.correction ? 'correction' : d.ready ? 'ready' : 'draft';
    return { state, entryId: d.id, entryNo: null };
  }
  if (signed.length > 0) return { state: 'signed', entryId: signed[0].id, entryNo: signed[0].entry_no ?? null };
  if (date > today) return { state: 'future', entryId: null, entryNo: null };
  if (oldest == null || date < oldest) return { state: 'before', entryId: null, entryNo: null };
  return { state: isRestDay(date) ? 'rest' : 'gap', entryId: null, entryNo: null };
}

/** The month as rows of seven tiles, Monday first, padded with the neighbouring months' days. */
export function monthTiles(rows: readonly CalendarRow[], month: string, today: string): DayTile[][] {
  const byDate = new Map<string, CalendarRow[]>();
  for (const r of rows) { const l = byDate.get(r.entry_date); if (l) l.push(r); else byDate.set(r.entry_date, [r]); }
  const oldest = rows.length ? rows.map((r) => r.entry_date).sort()[0] : null;
  const first = weekStart(`${month}-01`);
  const last = monthEnd(month);
  const weeks: DayTile[][] = [];
  for (let d = first; d <= last; d = addDays(d, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => {
      const date = addDays(d, i);
      const s = dayState(byDate.get(date) ?? [], date, today, oldest);
      return { date, ...s, inMonth: monthOf(date) === month, today: date === today };
    }));
  }
  return weeks;
}

export interface MonthSummary { signed: number; drafts: number; ready: number; corrections: number; gaps: number }

/** The month's figures from its own tiles — the same states the tiles show. */
export function summariseMonth(weeks: readonly DayTile[][]): MonthSummary {
  const tiles = weeks.flat().filter((t) => t.inMonth);
  const n = (s: DayState) => tiles.filter((t) => t.state === s).length;
  return { signed: n('signed'), drafts: n('draft') + n('ready'), ready: n('ready'), corrections: n('correction'), gaps: n('gap') };
}
