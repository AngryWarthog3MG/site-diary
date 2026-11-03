// Relative on purpose: this module is unit-tested under plain Node, which has no '@/' alias.
import { normaliseName } from '../crew/tickets.ts';
import { perthDate } from '../pdf/dates.ts';
import { addMonths } from '../forms/schedule.ts';

/**
 * Training courses and classes (README R188): the company's course catalogue,
 * the sessions it runs, who is booked on each and what came of it — and the
 * one arithmetic for the training report. Pure; the screens, the PDFs and the
 * matrix read it. Every rule here is the TypeScript half of a trigger in
 * 20261103170000_training_courses.sql, and the database wins.
 */

export const COURSE_KINDS = ['induction', 'high_risk_licence', 'licence', 'vet', 'internal', 'awareness', 'voc', 'other'] as const;
export type CourseKind = (typeof COURSE_KINDS)[number];
export const COURSE_KIND_LABEL: Record<CourseKind, string> = {
  induction: 'Induction',
  high_risk_licence: 'High-risk work licence',
  licence: 'Licence',
  vet: 'VET unit',
  internal: 'Internal',
  awareness: 'Awareness',
  voc: 'Verification of competency',
  other: 'Other',
};
export const PROVIDERS = ['internal', 'external'] as const;
export type Provider = (typeof PROVIDERS)[number];

export type ClassStatus = 'scheduled' | 'held' | 'cancelled';
export const CLASS_STATUS_LABEL: Record<ClassStatus, string> = { scheduled: 'Scheduled', held: 'Held', cancelled: 'Cancelled' };
export type AttendeeStatus = 'booked' | 'attended' | 'absent' | 'withdrawn';
export const ATTENDEE_STATUS_LABEL: Record<AttendeeStatus, string> = { booked: 'Booked', attended: 'Attended', absent: 'Absent', withdrawn: 'Withdrawn' };
export type Result = 'pass' | 'fail';
export const RESULT_LABEL: Record<Result, string> = { pass: 'Competent', fail: 'Not yet competent' };

export interface CourseRow {
  id: string; org_id: string; code: string; name: string; kind: CourseKind;
  unit_of_competency: string | null; duration_hours: number | null; expiry_months: number | null;
  provider: Provider; provider_name: string | null; competency_key: string | null; notes: string | null; active: boolean;
}
export interface ClassRow {
  id: string; org_id: string; course_id: string; project_id: string | null;
  starts_at: string; ends_at: string | null; venue: string | null; trainer_name: string | null; capacity: number | null;
  status: ClassStatus; held_at: string | null; cancelled_at: string | null; cancelled_reason: string | null; notes: string | null;
}
export interface AttendeeRow {
  id: string; class_id: string; person_name: string; status: AttendeeStatus;
  hours: number | null; result: Result | null; notes: string | null; booked_at: string; marked_at: string | null;
}

const CODE_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,23}$/;
const KEY_RE = /^[a-z0-9_]{2,40}$/;

/** What stops a course being saved — the TS half of `app.training_courses_before_write` and the table's checks. */
export function courseProblems(c: { code: string; name: string; kind: string; duration_hours: number | null; expiry_months: number | null; provider: string; provider_name: string | null; competency_key: string | null }, knownKeys: ReadonlySet<string>): string[] {
  const out: string[] = [];
  if (!CODE_RE.test(c.code.trim())) out.push('A code is letters, digits, dots, dashes or slashes — up to 24.');
  if (!c.name.trim()) out.push('A course has a name.');
  if (!(COURSE_KINDS as readonly string[]).includes(c.kind)) out.push('Pick a kind.');
  if (c.duration_hours != null && !(c.duration_hours > 0 && c.duration_hours <= 999)) out.push('Duration is hours, more than none.');
  if (c.expiry_months != null && !(Number.isInteger(c.expiry_months) && c.expiry_months >= 1 && c.expiry_months <= 120)) out.push('Expiry is 1 to 120 months, or blank if it does not lapse.');
  if (c.provider === 'external' && !(c.provider_name ?? '').trim()) out.push('An external course names its provider.');
  if (c.competency_key != null && c.competency_key !== '' && (!KEY_RE.test(c.competency_key) || !knownKeys.has(c.competency_key))) out.push('That competency is not one the company keeps.');
  return out;
}

/** What stops a class being saved. */
export function classProblems(c: { course_id: string; starts_at: string; ends_at: string | null; capacity: number | null }): string[] {
  const out: string[] = [];
  if (!c.course_id) out.push('Pick a course.');
  if (!c.starts_at || Number.isNaN(Date.parse(c.starts_at))) out.push('When does it start?');
  else if (c.ends_at && Date.parse(c.ends_at) <= Date.parse(c.starts_at)) out.push('It ends after it starts.');
  if (c.capacity != null && !(Number.isInteger(c.capacity) && c.capacity >= 1 && c.capacity <= 500)) out.push('Seats is a whole number, 1 to 500, or blank.');
  return out;
}

/** Hours a class runs, from its own clocks, to two places; null when it has no end. Twin of `app.training_class_span_hours`. */
export function spanHours(cls: Pick<ClassRow, 'starts_at' | 'ends_at'>): number | null {
  if (!cls.ends_at) return null;
  const ms = Date.parse(cls.ends_at) - Date.parse(cls.starts_at);
  if (!(ms > 0)) return null;
  return Math.round((ms / 3_600_000) * 100) / 100;
}

/** The hours an attendance counts: given, else the class's span, else the course's duration, else not recorded. Never 0. */
export function attendedHours(att: Pick<AttendeeRow, 'status' | 'hours'>, cls: Pick<ClassRow, 'starts_at' | 'ends_at'>, course: Pick<CourseRow, 'duration_hours'>): number | null {
  if (att.status !== 'attended') return null;
  return att.hours ?? spanHours(cls) ?? course.duration_hours ?? null;
}

/** Seats still open: capacity less those booked or attended; null when the class has no cap. */
export function seatsLeft(cls: Pick<ClassRow, 'capacity'>, attendees: ReadonlyArray<Pick<AttendeeRow, 'status'>>): number | null {
  if (cls.capacity == null) return null;
  return Math.max(0, cls.capacity - attendees.filter((a) => a.status === 'booked' || a.status === 'attended').length);
}

export function classDay(cls: Pick<ClassRow, 'starts_at'>): string { return perthDate(cls.starts_at); }

export type ClassWhen = 'past' | 'today' | 'upcoming';
export function classWhen(cls: Pick<ClassRow, 'starts_at'>, today: string): ClassWhen {
  const day = classDay(cls);
  return day < today ? 'past' : day === today ? 'today' : 'upcoming';
}

/** One line for the screen and the paper. */
export function classStateText(cls: Pick<ClassRow, 'starts_at' | 'status'>, today: string): string {
  if (cls.status === 'cancelled') return 'Cancelled';
  if (cls.status === 'held') return 'Held';
  const when = classWhen(cls, today);
  return when === 'today' ? 'Today' : when === 'upcoming' ? 'Scheduled' : 'Run, not yet marked';
}

/** Soonest first. */
export function sortClasses<T extends Pick<ClassRow, 'starts_at'>>(classes: readonly T[]): T[] {
  return classes.slice().sort((a, b) => a.starts_at.localeCompare(b.starts_at));
}

/**
 * For the matrix: who is booked on a class that earns which competency, by the class's day — only bookings still
 * standing on a scheduled class on or after today. A booking is never a record; the matrix shows it beside the gap.
 */
export function bookingsByPerson(attendees: readonly AttendeeRow[], classes: readonly ClassRow[], courses: readonly CourseRow[], today: string): Map<string, string> {
  const course = new Map(courses.map((c) => [c.id, c]));
  const cls = new Map(classes.map((c) => [c.id, c]));
  const out = new Map<string, string>();
  for (const a of attendees) {
    if (a.status !== 'booked') continue;
    const c = cls.get(a.class_id); if (!c || c.status !== 'scheduled') continue;
    const day = classDay(c); if (day < today) continue;
    const key = course.get(c.course_id)?.competency_key; if (!key) continue;
    const k = `${normaliseName(a.person_name)}|${key}`;
    const have = out.get(k);
    if (!have || day < have) out.set(k, day);
  }
  return out;
}

/** The key `bookingsByPerson` files under, for the matrix to ask with. */
export function bookingKey(personName: string, competencyKey: string): string { return `${normaliseName(personName)}|${competencyKey}`; }

/** Why an attendance cannot have its ticket recorded yet — null when it can. Twin of `app.crew_tickets_class_link`. */
export function ticketBlocker(att: Pick<AttendeeRow, 'status' | 'result'>, course: Pick<CourseRow, 'competency_key'>, alreadyRecorded: boolean): string | null {
  if (!course.competency_key) return 'This course earns no ticket.';
  if (att.status !== 'attended') return 'Not marked attended.';
  if (att.result !== 'pass') return 'Not marked competent.';
  if (alreadyRecorded) return 'Ticket already recorded.';
  return null;
}

/** The ticket's dates from the attendance: issued the class's day, expiring by the course's months where it has them. */
export function ticketDates(cls: Pick<ClassRow, 'starts_at'>, course: Pick<CourseRow, 'expiry_months'>): { issued_on: string; expires_on: string | null } {
  const issued = classDay(cls);
  return { issued_on: issued, expires_on: course.expiry_months ? addMonths(issued, course.expiry_months) : null };
}

export interface ReportLine {
  person_name: string; course_code: string; course_name: string; kind: CourseKind; unit_of_competency: string | null;
  class_id: string; day: string; trainer_name: string | null; provider: Provider; provider_name: string | null;
  hours: number | null; result: Result | null; ticketRecorded: boolean;
}
export interface PersonHours { person_name: string; lines: number; hours: number; unrecorded: number; passed: number; failed: number }
export interface TrainingReport {
  from: string; to: string;
  lines: ReportLine[];
  people: PersonHours[];
  /** Hours over every line that has them. */
  totalHours: number;
  attended: number; passed: number; failed: number;
  /** Lines with no hours on them — said, never counted as zero. */
  unrecorded: number;
}

/**
 * Completed training and training hours over a period (both ends inclusive, Perth days): every attendance on a
 * class held in the window, by person then day. Hours are the attendance's (`attendedHours`); a line without
 * them is listed and counted as unrecorded, never as 0.
 */
export function trainingReport(
  attendees: readonly AttendeeRow[], classes: readonly ClassRow[], courses: readonly CourseRow[],
  ticketsByAttendee: ReadonlySet<string>, from: string, to: string,
): TrainingReport {
  const course = new Map(courses.map((c) => [c.id, c]));
  const cls = new Map(classes.map((c) => [c.id, c]));
  const lines: ReportLine[] = [];
  for (const a of attendees) {
    if (a.status !== 'attended') continue;
    const c = cls.get(a.class_id); if (!c || c.status === 'cancelled') continue;
    const day = classDay(c); if (day < from || day > to) continue;
    const k = course.get(c.course_id); if (!k) continue;
    lines.push({
      person_name: a.person_name, course_code: k.code, course_name: k.name, kind: k.kind, unit_of_competency: k.unit_of_competency,
      class_id: c.id, day, trainer_name: c.trainer_name, provider: k.provider, provider_name: k.provider_name,
      hours: attendedHours(a, c, k), result: a.result, ticketRecorded: ticketsByAttendee.has(a.id),
    });
  }
  lines.sort((x, y) => x.person_name.localeCompare(y.person_name) || x.day.localeCompare(y.day) || x.course_code.localeCompare(y.course_code));
  const byPerson = new Map<string, PersonHours>();
  for (const l of lines) {
    const key = normaliseName(l.person_name);
    const p = byPerson.get(key) ?? { person_name: l.person_name, lines: 0, hours: 0, unrecorded: 0, passed: 0, failed: 0 };
    p.lines += 1;
    if (l.hours == null) p.unrecorded += 1; else p.hours = Math.round((p.hours + l.hours) * 100) / 100;
    if (l.result === 'pass') p.passed += 1; else if (l.result === 'fail') p.failed += 1;
    byPerson.set(key, p);
  }
  const people = [...byPerson.values()].sort((a, b) => a.person_name.localeCompare(b.person_name));
  return {
    from, to, lines, people,
    totalHours: Math.round(people.reduce((n, p) => n + p.hours, 0) * 100) / 100,
    attended: lines.length,
    passed: lines.filter((l) => l.result === 'pass').length,
    failed: lines.filter((l) => l.result === 'fail').length,
    unrecorded: lines.filter((l) => l.hours == null).length,
  };
}

export interface ClassSummary { upcoming: number; today: number; needsMarking: number; booked: number; heldThisYear: number }

/** The counts the classes page leads with. */
export function summariseClasses(classes: readonly ClassRow[], attendees: readonly AttendeeRow[], today: string): ClassSummary {
  const out: ClassSummary = { upcoming: 0, today: 0, needsMarking: 0, booked: 0, heldThisYear: 0 };
  const year = today.slice(0, 4);
  for (const c of classes) {
    if (c.status === 'cancelled') continue;
    const when = classWhen(c, today);
    if (c.status === 'held') { if (classDay(c).startsWith(year)) out.heldThisYear += 1; continue; }
    if (when === 'upcoming') out.upcoming += 1;
    else if (when === 'today') out.today += 1;
    else out.needsMarking += 1;
  }
  const live = new Set(classes.filter((c) => c.status === 'scheduled' && classWhen(c, today) !== 'past').map((c) => c.id));
  out.booked = attendees.filter((a) => a.status === 'booked' && live.has(a.class_id)).length;
  return out;
}

/** A Perth clock for a timestamp, HH:MM, by arithmetic (the PDF needs no Intl). */
export function perthClock(iso: string): string {
  const d = new Date(Date.parse(iso) + 8 * 3_600_000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

/** "Tue 03/11/2026 07:00–11:00" — the class's day and clocks, Perth. */
export function classWhenText(cls: Pick<ClassRow, 'starts_at' | 'ends_at'>): string {
  const day = classDay(cls);
  const dmy = `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(`${day}T00:00:00Z`).getUTCDay()];
  return `${dow} ${dmy} ${perthClock(cls.starts_at)}${cls.ends_at ? `–${perthClock(cls.ends_at)}` : ''}`;
}
