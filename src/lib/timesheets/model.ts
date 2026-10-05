/**
 * The company timesheet (README R103): everyone's hours for one week across every
 * job the caller is on, read from the diary's labour rows — the record the
 * supervisor confirmed — never from the gate on its own. Pure, relative imports
 * only; node-tested. Nothing here invents an hour: a row with no hours is "not
 * recorded", never 0, and is counted apart so the sheet says so.
 *
 * One other source (README R122): time the office adds by hand for a day with no
 * diary — the office, the yard, a training room. It arrives as a fact with `added`
 * set and a place where a job would be, and the sheet marks it everywhere it shows.
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
  /** The name as the diary wrote it, when the resolver turned it into another (README R107). */
  saidAs?: string;
  /** The day's clocks, "HH:MM", when recorded — they tell two jobs at once apart from two jobs in a day. */
  start?: string | null;
  finish?: string | null;
  /** Added by the office, not read from a diary (README R122): `projectCode` is then the place it was worked. */
  added?: boolean;
}

/** A line the office added to the timesheet (README R122) — `timesheet_entries` as the screen reads it. */
export interface OfficeTime {
  id: string;
  orgId: string;
  personName: string;
  date: string;
  start: string | null;
  finish: string | null;
  breakMins: number;
  hours: number;
  place: string;
  note: string | null;
  addedBy: string | null;
  addedAt: string;
  voidedAt: string | null;
  voidReason: string | null;
}

/** The id an added line's place goes by among the sheet's jobs: never a project's id. */
export const officeJobId = (place: string) => `office:${normName(place)}`;

/** An added line as the sheet counts it. `resolve` is the company's list of names that are one person. */
export function officeFact(t: OfficeTime, resolve: (name: string) => string = (n) => n): LabourFact {
  const name = resolve(t.personName);
  return {
    entryId: '', projectId: officeJobId(t.place), projectCode: t.place.trim(), projectName: 'Added by the office',
    date: t.date, signed: true, personName: name, role: null, hours: t.hours, overtimeHours: null,
    saidAs: normName(name) !== normName(t.personName) ? t.personName.trim() : undefined,
    start: t.start, finish: t.finish, added: true,
  };
}

/**
 * Hours between two clocks less the break — the same arithmetic the database does on an added line (the database
 * wins). Null when a clock is missing or unreadable, or the answer is not a positive number of hours: never a guess.
 */
export function hoursFromClocks(start: string | null | undefined, finish: string | null | undefined, breakMins = 0): number | null {
  const a = minutes(start); const b = minutes(finish);
  if (a == null || b == null || !Number.isFinite(breakMins) || breakMins < 0) return null;
  const worked = b - a - breakMins;
  return worked > 0 ? round2(worked / 60) : null;
}

/**
 * One person, one row (README R107). A job's crew list knows its own nicknames — they apply to that job's rows only,
 * because "Matt" on one job may be someone else on another — and the company's list of names that are one person
 * applies everywhere. Chains are followed a few steps; anything unknown is itself.
 */
export function makeResolver(
  crew: ReadonlyArray<{ projectId: string; name: string; aliases: readonly string[] | null }>,
  company: ReadonlyArray<{ alias: string; name: string }>,
): (name: string, projectId: string) => string {
  const perJob = new Map<string, string>();
  for (const c of crew) for (const a of c.aliases ?? []) if (a.trim()) perJob.set(`${c.projectId}|${normName(a)}`, c.name.trim());
  const everywhere = new Map(company.map((c) => [normName(c.alias), c.name.trim()]));
  return (name, projectId) => {
    let out = perJob.get(`${projectId}|${normName(name)}`) ?? name.trim();
    for (let i = 0; i < 5; i++) {
      const next = everywhere.get(normName(out));
      if (!next || normName(next) === normName(out)) break;
      out = next;
    }
    return out;
  };
}

const minutes = (t: string | null | undefined): number | null => {
  const m = typeof t === 'string' ? /^(\d{1,2}):(\d{2})/.exec(t) : null;
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

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
  /** Rows the office added by hand (README R122), not read from a diary. */
  added: number;
  /** On two jobs at overlapping times — or, with no clocks, over 14 h across them. Someone should check. */
  clash: boolean;
  spans: Array<{ code: string; start: number | null; finish: number | null; hours: number | null }>;
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
  /** Other spellings folded into this row, as the diaries wrote them. */
  aka: string[];
  clashes: number;
  /** Rows the office added by hand. */
  added: number;
}

export interface JobTotal { projectId: string; code: string; name: string; hours: number; people: number; rows: number; /** A place the office added time at, not a job. */ office?: boolean }

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
  clashes: number;
  /** Rows the office added by hand, and the hours on them — counted in every total above, and said apart. */
  addedRows: number;
  addedHours: number;
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
  let addedRows = 0;
  let addedHours = 0;

  for (const f of inWeek) {
    const key = normName(f.personName);
    let p = people.get(key);
    if (!p) {
      p = { key, name: f.personName.trim(), roles: [], days: {}, total: 0, overtime: 0, byJob: {}, noHours: 0, unsigned: false, aka: [], clashes: 0, added: 0, spellings: new Map() };
      people.set(key, p);
    }
    p.spellings.set(f.personName.trim(), (p.spellings.get(f.personName.trim()) ?? 0) + 1);
    const said = f.saidAs?.trim();
    if (said && normName(said) !== key && !p.aka.some((a) => normName(a) === normName(said))) p.aka.push(said);
    const role = f.role?.trim();
    if (role && !p.roles.some((r) => r.toLowerCase() === role.toLowerCase())) p.roles.push(role);
    let cell = p.days[f.date];
    if (!cell) { cell = { hours: null, overtime: 0, jobs: [], rows: 0, noHours: 0, unsigned: false, entryIds: [], added: 0, clash: false, spans: [] }; p.days[f.date] = cell; }
    cell.spans.push({ code: f.projectCode, start: minutes(f.start), finish: minutes(f.finish), hours: f.hours });
    cell.rows += 1;
    if (!cell.jobs.includes(f.projectCode)) cell.jobs.push(f.projectCode);
    if (f.entryId && !cell.entryIds.includes(f.entryId)) cell.entryIds.push(f.entryId);
    if (f.added) { cell.added += 1; p.added += 1; addedRows += 1; addedHours = round2(addedHours + (f.hours ?? 0)); }
    if (!f.signed) { cell.unsigned = true; p.unsigned = true; unsignedRows += 1; }
    const ot = f.overtimeHours ?? 0;
    if (ot) { cell.overtime = round2(cell.overtime + ot); p.overtime = round2(p.overtime + ot); overtime = round2(overtime + ot); }
    let j = jobs.get(f.projectId);
    if (!j) { j = { projectId: f.projectId, code: f.projectCode, name: f.projectName, hours: 0, people: 0, rows: 0, names: new Set(), ...(f.added ? { office: true } : {}) }; jobs.set(f.projectId, j); }
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

  // Two jobs at once: spans on different jobs whose clocks overlap; with a clock missing, more than 14 h between them.
  let clashes = 0;
  for (const p of people.values()) {
    for (const cell of Object.values(p.days)) {
      if (cell.jobs.length < 2) continue;
      let clash = false;
      for (let i = 0; i < cell.spans.length && !clash; i++) {
        for (let j = i + 1; j < cell.spans.length && !clash; j++) {
          const a = cell.spans[i]; const b = cell.spans[j];
          if (a.code === b.code) continue;
          if (a.start != null && a.finish != null && b.start != null && b.finish != null) clash = a.start < b.finish && b.start < a.finish;
          else clash = (cell.hours ?? 0) > 14;
        }
      }
      if (clash) { cell.clash = true; p.clashes += 1; clashes += 1; }
    }
  }

  const rows: PersonRow[] = Array.from(people.values()).map((p) => {
    let best = p.name; let n = -1;
    for (const [s, c] of p.spellings) if (c > n) { best = s; n = c; }
    const { spellings: _s, ...row } = p;
    void _s;
    return { ...row, name: best, aka: [...new Set([...row.aka, ...[..._s.keys()].filter((s) => s !== best)])] };
  }).sort((a, b) => a.name.localeCompare(b.name));

  const jobRows: JobTotal[] = Array.from(jobs.values()).map(({ names, ...j }) => ({ ...j, people: names.size })).sort((a, b) => Number(Boolean(a.office)) - Number(Boolean(b.office)) || a.code.localeCompare(b.code));

  return { from: monday, to, days, people: rows, jobs: jobRows, dayTotals, total, overtime, noHours, unsignedRows, clashes, addedRows, addedHours };
}
