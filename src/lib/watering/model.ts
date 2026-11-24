/**
 * The watering register (README R190): which area of a landscape job was watered on which day, how, and for how many
 * hours — with any supplementary watering beside it, a note, and the day's maximum temperature. Pure: the screen, the
 * printed week and the tests all read these, and nothing here touches the network. Relative imports only — node-tested.
 *
 * Three rules the register keeps (the database enforces each; these are the screen's half):
 *  - hours never stand without a method; a method may wait for its hours (unstated is null, and the register asks);
 *  - a day somebody recorded says "not watered" for an empty area; a day nobody recorded says "not recorded";
 *  - a week closes once it is over with no hours outstanding, and then nothing in it changes.
 */

export const METHODS = ['irrigation', 'manual', 'soaker'] as const;
export type Method = (typeof METHODS)[number];
export const METHOD_LABEL: Record<Method, string> = { irrigation: 'Irrigation', manual: 'Manual water', soaker: 'Soaker hoses' };
/** The grid's and the printed week's shorter word. */
export const METHOD_SHORT: Record<Method, string> = { irrigation: 'Irrigation', manual: 'Manual', soaker: 'Soaker' };
export const isMethod = (v: unknown): v is Method => typeof v === 'string' && (METHODS as readonly string[]).includes(v);

export interface WateringArea { id: string; project_id: string; name: string; sort_order: number; active: boolean }
export interface WateringLine { method: Method | null; hours: number | null; supp_method: Method | null; supp_hours: number | null; notes: string | null }
export interface WateringEntry extends WateringLine { area_id: string; day: string; updated_at?: string | null; updated_by_name?: string | null }
export interface WateringDay { day: string; temp_max: number | null; recorded_at?: string | null; recorded_by_name?: string | null }
export interface WateringClose { week_start: string; closed_at: string; closed_by_name: string | null }

export const NOTES_MAX = 1000;
export const TEMP_MIN = -10;
export const TEMP_MAX = 60;

// ---- Days and weeks, by arithmetic on ISO days (a register is read in Perth and printed anywhere) -------------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
export const DAY_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
/** The Monday of the week a day falls in. */
export function weekOf(date: string): string {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, dow === 0 ? -6 : 1 - dow);
}
export function weekDays(monday: string): string[] { return Array.from({ length: 7 }, (_, i) => addDays(monday, i)); }
/** The week the address asks for, snapped to its Monday; unreadable, or a week not yet begun, is this week. */
export function readWeek(param: string | undefined, today: string): string {
  const ok = typeof param === 'string' && DATE_RE.test(param) && !Number.isNaN(Date.parse(`${param}T00:00:00Z`));
  const monday = weekOf(ok ? param : today);
  return monday > weekOf(today) ? weekOf(today) : monday;
}
export const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
export const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
/** The week is over once its Sunday has gone by. */
export const weekOver = (monday: string, today: string) => addDays(monday, 6) < today;

// ---- What was typed ------------------------------------------------------------------------------------------------

/** Hours as typed: blank is "not stated" (null, and fine); a number must be over 0 and at most 24. */
export function readHours(text: string): { value: number | null; ok: boolean } {
  const t = text.trim();
  if (t === '') return { value: null, ok: true };
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0 || n > 24) return { value: null, ok: false };
  return { value: Math.round(n * 100) / 100, ok: true };
}
/** The maximum temperature as typed: blank is "not read"; a number between -10 and 60, to one decimal. */
export function readTemp(text: string): { value: number | null; ok: boolean } {
  const t = text.trim();
  if (t === '') return { value: null, ok: true };
  const n = Number(t);
  if (!Number.isFinite(n) || n < TEMP_MIN || n > TEMP_MAX) return { value: null, ok: false };
  return { value: Math.round(n * 10) / 10, ok: true };
}
/** Hours for a reader: 2, 0.5, 4.75 — never a float's tail. */
export function fmtHours(n: number): string { return String(Math.round(n * 100) / 100); }

// ---- A line --------------------------------------------------------------------------------------------------------

export const isBlank = (l: WateringLine) => !l.method && !l.supp_method && !(l.notes ?? '').trim();
export const watered = (l: WateringLine | null | undefined) => Boolean(l && (l.method || l.supp_method));

/** What the database would refuse — the TS half of the table's constraints. */
export function lineProblems(l: WateringLine): string[] {
  const out: string[] = [];
  const bad = (h: number | null) => h != null && (!(h > 0) || h > 24);
  if (l.hours != null && !l.method) out.push('Hours need a method beside them.');
  if (l.supp_hours != null && !l.supp_method) out.push('Supplementary hours need a method beside them.');
  if (bad(l.hours) || bad(l.supp_hours)) out.push('Hours are over 0 and at most 24.');
  if ((l.notes ?? '').length > NOTES_MAX) out.push(`A note is at most ${NOTES_MAX} characters.`);
  return out;
}
/** What is still to be stated: a method recorded with no hours. Not a refusal — the register asks until it is answered. */
export function lineGaps(l: WateringLine): Array<'hours' | 'supp_hours'> {
  const out: Array<'hours' | 'supp_hours'> = [];
  if (l.method && l.hours == null) out.push('hours');
  if (l.supp_method && l.supp_hours == null) out.push('supp_hours');
  return out;
}

export type CellState = 'watered' | 'not_watered' | 'not_recorded' | 'ahead';
/** One area on one day. A line with watering on it is watered; otherwise the DAY says whether "nothing" was recorded or just not written. */
export function cellState(entry: WateringLine | null | undefined, dayRecorded: boolean, day: string, today: string): CellState {
  if (watered(entry)) return 'watered';
  if (dayRecorded || entry) return 'not_watered';
  return day > today ? 'ahead' : 'not_recorded';
}

// ---- A week --------------------------------------------------------------------------------------------------------

export const entryKey = (areaId: string, day: string) => `${areaId}|${day}`;
export function indexEntries<T extends { area_id: string; day: string }>(entries: readonly T[]): Map<string, T> {
  return new Map(entries.map((e) => [entryKey(e.area_id, e.day), e]));
}

/** The areas a week shows: the active ones, and a retired one only where it has a line in the week. In the list's order. */
export function shownAreas(areas: readonly WateringArea[], entries: ReadonlyArray<{ area_id: string }>): WateringArea[] {
  const used = new Set(entries.map((e) => e.area_id));
  return areas.filter((a) => a.active || used.has(a.id)).slice().sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
}

export interface AreaHours { main: number; supp: number; total: number; any: boolean; gaps: number }
/** An area's hours over the lines given. Hours not stated are not counted and not guessed — they are counted as gaps. */
export function areaHours(lines: readonly WateringLine[]): AreaHours {
  let main = 0, supp = 0, gaps = 0, any = false;
  for (const l of lines) {
    if (l.method && l.hours != null) { main += l.hours; any = true; }
    if (l.supp_method && l.supp_hours != null) { supp += l.supp_hours; any = true; }
    gaps += lineGaps(l).length;
  }
  const r = (n: number) => Math.round(n * 100) / 100;
  return { main: r(main), supp: r(supp), total: r(main + supp), any, gaps };
}

export interface WeekSummary {
  main: number; supp: number; total: number; gaps: number;
  /** Days of the week that have come. */
  due: number;
  recorded: number;
  /** Days that have come and nobody recorded. */
  unrecorded: string[];
  hottest: { day: string; temp: number } | null;
}
export function summariseWeek(monday: string, today: string, entries: readonly WateringEntry[], days: readonly WateringDay[]): WeekSummary {
  const week = weekDays(monday);
  const inWeek = entries.filter((e) => week.includes(e.day));
  const h = areaHours(inWeek);
  const recordedDays = new Set([...days.map((d) => d.day), ...inWeek.map((e) => e.day)]);
  const dueDays = week.filter((d) => d <= today);
  let hottest: WeekSummary['hottest'] = null;
  for (const d of days) if (week.includes(d.day) && d.temp_max != null && (!hottest || d.temp_max > hottest.temp)) hottest = { day: d.day, temp: d.temp_max };
  return { main: h.main, supp: h.supp, total: h.total, gaps: h.gaps, due: dueDays.length, recorded: dueDays.filter((d) => recordedDays.has(d)).length, unrecorded: dueDays.filter((d) => !recordedDays.has(d)), hottest };
}

/** Why a week will not close — the TS half of app.watering_weeks_before_insert; the database wins. */
export function closeProblems(monday: string, today: string, entries: readonly WateringEntry[], areaName: (areaId: string) => string): string[] {
  const out: string[] = [];
  if (!weekOver(monday, today)) out.push('A week is closed once it is over — after its Sunday.');
  const week = weekDays(monday);
  for (const e of entries.slice().sort((a, b) => a.day.localeCompare(b.day))) {
    if (!week.includes(e.day)) continue;
    const i = week.indexOf(e.day);
    for (const g of lineGaps(e)) out.push(`${DAY_SHORT[i]} ${dm(e.day)} · ${areaName(e.area_id)}${g === 'supp_hours' ? ' supplementary' : ''} still needs its hours.`);
  }
  return out;
}

/** The names typed into the add box, one per line: tidied, blank lines dropped, one of each (whatever the case), and none the job already has. */
export function readAreaNames(text: string, existing: readonly string[]): string[] {
  const have = new Set(existing.map((n) => n.trim().toLowerCase()));
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const name = raw.replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!name || have.has(name.toLowerCase())) continue;
    have.add(name.toLowerCase());
    out.push(name);
  }
  return out;
}
