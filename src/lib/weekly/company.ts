/**
 * The company's weekly report (README R108): every job's week, side by side, with the company's totals and what needs
 * attention. Pure, relative imports — node-tested. Every figure is the job's own weekly report's figure (the same
 * loader), added up: no number here is computed any other way, and nothing is written by a model.
 */
import type { WeeklyData } from './load';

export interface JobWeek {
  projectId: string;
  name: string;
  code: string;
  /** Working days (Mon–Fri) in the week from the job's start, and how many have a diary. */
  workingDays: number;
  /** No start date and no diary yet: nothing is missing from a job that has not begun. */
  notStarted: boolean;
  workingDaysRecorded: number;
  /** Days with a diary still being written up; their figures are in, marked. */
  unsignedDays: string[];
  restDaysWorked: number;
  labourHours: number;
  overtimeHours: number;
  people: string[];
  plantHours: number;
  plantIdle: number;
  concreteM3: number;
  delayHours: number;
  topDelay: string | null;
  variations: number;
  variationsUnnumbered: number;
  dayworkHours: number;
  dayworksWithoutDocket: number;
  instructions: number;
  rainMm: number;
  /** What was done, in the diary's words — the first few. */
  done: string[];
  delays: Array<{ date: string; cause: string; hours: number | null }>;
  variationRows: Array<{ date: string; number: string | null; description: string }>;
}

export interface CompanyWeek {
  start: string;
  end: string;
  jobs: JobWeek[];
  /** Jobs that could not be read, and why — shown, never dropped silently. */
  failed: Array<{ code: string; name: string; message: string }>;
  totals: {
    jobs: number;
    labourHours: number;
    overtimeHours: number;
    /** Distinct people across every job — one person on two jobs is one. */
    people: number;
    plantHours: number;
    concreteM3: number;
    delayHours: number;
    variations: number;
    dayworkHours: number;
    workingDaysMissing: number;
    unsignedDays: number;
  };
  attention: Array<{ code: string; text: string }>;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
const DONE_MAX = 6;
const V = (seq: number | null) => (seq == null ? null : `V-${String(seq).padStart(3, '0')}`);

/** Monday-to-Friday days from `from` to `to`, inclusive. */
export function weekdaysBetween(from: string, to: string): number {
  let n = 0;
  for (let t = new Date(`${from}T00:00:00Z`); t <= new Date(`${to}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + 1)) {
    const dow = t.getUTCDay();
    if (dow !== 0 && dow !== 6) n += 1;
  }
  return n;
}

/**
 * One job's week. `startsOn` is when the job began — its start date, else its first diary; null when it has neither,
 * which is a job not started. Left out, every working day of the week counts.
 */
export function summariseJob(d: WeeklyData, resolve: (name: string) => string = (n) => n, startsOn?: string | null): JobWeek {
  const topCat = [...d.delays.byCategory].sort((a, b) => b.minutes - a.minutes)[0];
  const notStarted = startsOn === null || (startsOn != null && startsOn > d.end);
  const workingDays = notStarted ? 0 : startsOn && startsOn > d.start ? weekdaysBetween(startsOn, d.end) : d.counts.workingDaysInRange;
  return {
    projectId: d.project.id,
    name: d.project.name,
    code: d.project.code,
    notStarted,
    workingDays: Math.max(workingDays, d.counts.workingDaysWithEntries),
    workingDaysRecorded: d.counts.workingDaysWithEntries,
    unsignedDays: d.unsigned.days,
    restDaysWorked: d.counts.restDaysWithEntries,
    labourHours: round2(d.labour.grandTotal),
    overtimeHours: round2(d.labour.overtimeTotal),
    people: [...new Set(d.labour.people.map((p) => resolve(p.name)).filter((n) => n.trim()))],
    plantHours: round2(d.plant.totalHours),
    plantIdle: round2(d.plant.totalIdle),
    concreteM3: round2(d.pours.totalVolume),
    delayHours: round2(d.delays.totalHours),
    topDelay: topCat && topCat.minutes > 0 ? topCat.category : null,
    variations: d.variations.rows.length,
    variationsUnnumbered: d.variations.unreferenced,
    dayworkHours: round2(d.dayworks.totalHours),
    dayworksWithoutDocket: d.dayworks.rows.filter((r) => !r.docket_ref && !r.docket_added).length,
    instructions: d.site_events.rows.length,
    rainMm: round2(d.weather.totalRainfallMm),
    done: d.workItems.rows.map((w) => (w.area ? `${w.description} — ${w.area}` : w.description)).filter(Boolean).slice(0, DONE_MAX),
    delays: d.delays.rows.map((r) => ({ date: r.date, cause: r.cause, hours: r.duration_mins == null ? null : round2(r.duration_mins / 60) })),
    variationRows: d.variations.rows.map((r) => ({ date: r.date, number: V(r.register_seq), description: r.description })),
  };
}

/** The company's week: jobs in code order, totals added from the jobs, and what needs someone's attention. */
export function rollUp(start: string, end: string, jobs: JobWeek[], failed: CompanyWeek['failed'] = []): CompanyWeek {
  const ordered = [...jobs].sort((a, b) => a.code.localeCompare(b.code));
  const people = new Set<string>();
  for (const j of ordered) for (const p of j.people) people.add(norm(p));
  const sum = (f: (j: JobWeek) => number) => round2(ordered.reduce((n, j) => n + f(j), 0));
  const attention: CompanyWeek['attention'] = [];
  for (const j of ordered) {
    if (j.notStarted) continue;
    const missing = j.workingDays - j.workingDaysRecorded;
    if (missing > 0) attention.push({ code: j.code, text: `${missing} working day${missing === 1 ? '' : 's'} with no diary` });
    if (j.unsignedDays.length) attention.push({ code: j.code, text: `${j.unsignedDays.length} day${j.unsignedDays.length === 1 ? '' : 's'} not signed yet` });
    if (j.variationsUnnumbered) attention.push({ code: j.code, text: `${j.variationsUnnumbered} variation${j.variationsUnnumbered === 1 ? '' : 's'} with no register number` });
    if (j.dayworksWithoutDocket) attention.push({ code: j.code, text: `${j.dayworksWithoutDocket} daywork${j.dayworksWithoutDocket === 1 ? '' : 's'} without a docket` });
  }
  return {
    start, end, jobs: ordered, failed,
    totals: {
      jobs: ordered.length,
      labourHours: sum((j) => j.labourHours),
      overtimeHours: sum((j) => j.overtimeHours),
      people: people.size,
      plantHours: sum((j) => j.plantHours),
      concreteM3: sum((j) => j.concreteM3),
      delayHours: sum((j) => j.delayHours),
      variations: sum((j) => j.variations),
      dayworkHours: sum((j) => j.dayworkHours),
      workingDaysMissing: sum((j) => Math.max(0, j.workingDays - j.workingDaysRecorded)),
      unsignedDays: sum((j) => j.unsignedDays.length),
    },
    attention,
  };
}
