/**
 * The company timesheet (README R103): everyone's hours for one week across every
 * job the caller is on, read from the diary's labour rows — the record the
 * supervisor confirmed — never from the gate on its own. Pure, relative imports
 * only; node-tested. Nothing here invents an hour: a row with no hours is "not
 * recorded", never 0, and is counted apart so the sheet says so.
 */

export interface LabourFact {
  entryId: string;
  projectId: string;
  projectCode: string;
  projectName: string;
  /** The diary day, ISO. */
  date: string;
  signed: boolean;
  personName: string;
  role: string | null;
  hours: number | null;
  overtimeHours: number | null;
}

export interface DayCell {
  /** Recorded hours summed; null when nothing for the day carried a figure. */
  hours: number | null;
  overtime: number;
  /** Job codes, in the order seen. */
  jobs: string[];
  rows: number;
  noHours: number;
  unsigned: boolean;
  entryIds: string[];
}

export interface PersonRow {
  key: string;
  name: string;
  roles: string[];
  days: Record<string, DayCell>;
  total: number;
  overtime: number;
  byJob: Record<string, number>;
  noHours: number;
  unsigned: boolean;
}

export interface JobTotal { projectId: string; code: string; name: string; hours: number; people: number; rows: number }

export interface Timesheet {
  from: string;
  to: string;
  days: string[];
  people: PersonRow[];
  jobs: JobTotal[];
  dayTotals: Record<string, number>;
  total: number;
  overtime: number;
  noHours: number;
  unsignedRows: number;
}

export const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const round2 = (n: number) => Math.round(n * 100) / 100;

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The Monday of the week a date falls in. */
export function weekOf(date: string): string {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 Sunday
  return addDays(date, dow === 0 ? -6 : 1 - dow);
}

export function weekDays(monday: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** The week asked for in the address, snapped to its Monday; anything unreadable is this week. */
export function readWeek(param: string | undefined, today: string): string {
  const ok = typeof param === 'string' && DATE_RE.test(param) && !Number.isNaN(Date.parse(`${param}T00:00:00Z`));
  return weekOf(ok ? param : today);
}

export const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
export const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** One person is one person however the name was spelt on the day. */
export function normName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function fmtHours(n: number | null): string {
  if (n == null) return '—';
  return Number.isInteger(n) ? String(n) : String(round2(n));
}

/** The week's sheet: a row per person, a cell per day, jobs and days totalled. Rows sorted by name. */
export function buildTimesheet(facts: readonly LabourFact[], monday: string): Timesheet {
  const days = weekDays(monday);
  const to = days[6];
  const inWeek = facts.filter((f) => f.date >= monday && f.date <= to && f.personName.trim() !== '');
  const people = new Map<string, PersonRow & { spellings: Map<string, number> }>();
  const jobs = new Map<string, JobTotal & { names: Set<string> }>();
  const dayTotals: Record<string, number> = Object.fromEntries(days.map((d) => [d, 0]));
  let total = 0;
  let overtime = 0;
  let noHours = 0;
  let unsignedRows = 0;

  for (const f of inWeek) {
    const key = normName(f.personName);
    let p = people.get(key);
    if (!p) {
      p = { key, name: f.personName.trim(), roles: [], days: {}, total: 0, overtime: 0, byJob: {}, noHours: 0, unsigned: false, spellings: new Map() };
      people.set(key, p);
    }
    p.spellings.set(f.personName.trim(), (p.spellings.get(f.personName.trim()) ?? 0) + 1);
    const role = f.role?.trim();
    if (role && !p.roles.some((r) => r.toLowerCase() === role.toLowerCase())) p.roles.push(role);
    let cell = p.days[f.date];
    if (!cell) { cell = { hours: null, overtime: 0, jobs: [], rows: 0, noHours: 0, unsigned: false, entryIds: [] }; p.days[f.date] = cell; }
    cell.rows += 1;
    if (!cell.jobs.includes(f.projectCode)) cell.jobs.push(f.projectCode);
    if (!cell.entryIds.includes(f.entryId)) cell.entryIds.push(f.entryId);
    if (!f.signed) { cell.unsigned = true; p.unsigned = true; unsignedRows += 1; }
    const ot = f.overtimeHours ?? 0;
    if (ot) { cell.overtime = round2(cell.overtime + ot); p.overtime = round2(p.overtime + ot); overtime = round2(overtime + ot); }
    let j = jobs.get(f.projectId);
    if (!j) { j = { projectId: f.projectId, code: f.projectCode, name: f.projectName, hours: 0, people: 0, rows: 0, names: new Set() }; jobs.set(f.projectId, j); }
    j.rows += 1;
    j.names.add(key);
    if (f.hours == null) { cell.noHours += 1; p.noHours += 1; noHours += 1; continue; }
    cell.hours = round2((cell.hours ?? 0) + f.hours);
    p.total = round2(p.total + f.hours);
    p.byJob[f.projectCode] = round2((p.byJob[f.projectCode] ?? 0) + f.hours);
    dayTotals[f.date] = round2(dayTotals[f.date] + f.hours);
    total = round2(total + f.hours);
    j.hours = round2(j.hours + f.hours);
  }

  const rows: PersonRow[] = Array.from(people.values()).map((p) => {
    let best = p.name; let n = -1;
    for (const [s, c] of p.spellings) if (c > n) { best = s; n = c; }
    const { spellings: _s, ...row } = p;
    void _s;
    return { ...row, name: best };
  }).sort((a, b) => a.name.localeCompare(b.name));

  const jobRows: JobTotal[] = Array.from(jobs.values()).map(({ names, ...j }) => ({ ...j, people: names.size })).sort((a, b) => a.code.localeCompare(b.code));

  return { from: monday, to, days, people: rows, jobs: jobRows, dayTotals, total, overtime, noHours, unsignedRows };
}
