/**
 * What falls due, and whether it happened on time.
 *
 * One shape for every obligation the app knows about, so the screen, the home
 * card and the nightly email all answer the auditor's question the same way:
 * show me the schedule, and show me each one happened when it was meant to.
 *
 * Pure and dependency-free. Dates are ISO calendar days in Perth; nothing here
 * reads a clock.
 */

export const OBLIGATION_KINDS = [
  'internal_audit', 'management_review', 'emergency_drill', 'compliance_evaluation', 'plan_review', 'inspection', 'other',
] as const;
export type ObligationKind = (typeof OBLIGATION_KINDS)[number];

export const KIND_LABEL: Record<ObligationKind, string> = {
  internal_audit: 'Internal audit',
  management_review: 'Management review',
  emergency_drill: 'Emergency drill',
  compliance_evaluation: 'Evaluation of compliance',
  plan_review: 'Plan review',
  inspection: 'Inspection',
  other: 'Other',
};

/**
 * Starting points for a new schedule, each with the clause that asks for it.
 * They are suggestions: the interval a principal's contract sets can be
 * tighter than the standard's "planned intervals", and the admin can change it.
 */
export const PRESETS: ReadonlyArray<{ kind: ObligationKind; title: string; intervalMonths: number | null; basis: string; scope: 'project' | 'org' }> = [
  { kind: 'internal_audit', title: 'Internal audit of this job', intervalMonths: 3, basis: 'ISO 9001, 45001, 14001 cl. 9.2 · Main Roads WA Spec 201 cl. 201.12.03 (at most three-monthly)', scope: 'project' },
  { kind: 'management_review', title: 'Management review of this job', intervalMonths: 3, basis: 'Main Roads WA Spec 201 cl. 201.13', scope: 'project' },
  { kind: 'management_review', title: 'Company management review', intervalMonths: 12, basis: 'ISO 9001, 45001, 14001 cl. 9.3', scope: 'org' },
  { kind: 'emergency_drill', title: 'Emergency procedures tested', intervalMonths: 6, basis: 'WHS (General) Regs 2022 (WA) reg. 43(1)(b) · ISO 45001 cl. 8.2', scope: 'project' },
  { kind: 'compliance_evaluation', title: 'Evaluation of compliance with legal obligations', intervalMonths: 12, basis: 'ISO 45001 cl. 9.1.2 · ISO 14001 cl. 9.1.2', scope: 'org' },
  { kind: 'plan_review', title: 'Asbestos management plan reviewed', intervalMonths: 60, basis: 'WHS (General) Regs 2022 (WA) reg. 429', scope: 'project' },
];

/** How far ahead something is "due soon" rather than merely upcoming. */
export const DUE_SOON_DAYS = 30;

export type DueStatus = 'overdue' | 'due_soon' | 'upcoming' | 'done';

export const STATUS_LABEL: Record<DueStatus, string> = {
  overdue: 'Overdue',
  due_soon: 'Due soon',
  upcoming: 'Upcoming',
  done: 'Done',
};

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Add calendar months, clamping to the end of a shorter month (31 Jan + 1 → 28 or 29 Feb). */
export function addMonths(iso: string, months: number): string {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7)) - 1;
  const day = Number(iso.slice(8, 10));
  const total = m + months;
  const ny = y + Math.floor(total / 12);
  const nm = ((total % 12) + 12) % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  const nd = Math.min(day, last);
  return `${String(ny).padStart(4, '0')}-${String(nm + 1).padStart(2, '0')}-${String(nd).padStart(2, '0')}`;
}

export interface ScheduleFacts {
  first_due_on: string;
  interval_months: number | null;
  active: boolean;
}

export interface CompletionFacts {
  due_on: string;
  done_on: string;
}

/** The last completion, by when it was done. */
export function lastCompletion(completions: readonly CompletionFacts[]): CompletionFacts | null {
  if (completions.length === 0) return null;
  return completions.reduce((a, b) => (a.done_on >= b.done_on ? a : b));
}

/**
 * When the next occurrence is due, or null when there is none — a one-off that
 * has been done, or a schedule that has been retired.
 *
 * Counted from when the last one was DONE. A maximum interval limits the gap
 * between two occurrences; an audit done a month late does not buy the next
 * one a month's grace, and one done early does not pull the next one forward
 * past what the interval allows.
 */
export function nextDue(schedule: ScheduleFacts, completions: readonly CompletionFacts[]): string | null {
  if (!schedule.active) return null;
  const last = lastCompletion(completions);
  if (!last) return schedule.first_due_on;
  if (schedule.interval_months == null) return null;
  return addMonths(last.done_on, schedule.interval_months);
}

export function dueStatus(dueOn: string | null, today: string, soonDays = DUE_SOON_DAYS): DueStatus {
  if (dueOn == null) return 'done';
  if (dueOn < today) return 'overdue';
  if (dueOn <= addDays(today, soonDays)) return 'due_soon';
  return 'upcoming';
}

/** Whether an occurrence was done by the day it was due. The evidence an auditor asks for. */
export function onTime(completion: CompletionFacts): boolean {
  return completion.done_on <= completion.due_on;
}

/** Days late, or 0 when on time. */
export function daysLate(completion: CompletionFacts): number {
  if (onTime(completion)) return 0;
  const a = Date.parse(`${completion.due_on}T00:00:00Z`);
  const b = Date.parse(`${completion.done_on}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/** Where an item came from. Only 'scheduled' is stored as an obligation; the rest are read off their records. */
export type ItemSource = 'scheduled' | 'sds' | 'ticket' | 'incident';

export interface ObligationItem {
  key: string;
  source: ItemSource;
  title: string;
  /** The clause or regulation that makes it due. */
  basis: string | null;
  dueOn: string | null;
  status: DueStatus;
  /** Where to go to deal with it. */
  href: string | null;
  /** Set for a scheduled item, so it can be marked done. */
  obligationId?: string;
  /** For a scheduled item: how many past occurrences were late. */
  lateCount?: number;
  completed?: number;
}

const STATUS_ORDER: Record<DueStatus, number> = { overdue: 0, due_soon: 1, upcoming: 2, done: 3 };

/** Overdue first, then due soon, then upcoming; the earliest date first within each. */
export function sortItems(items: readonly ObligationItem[]): ObligationItem[] {
  return [...items].sort((a, b) =>
    STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
    || (a.dueOn ?? '9999-12-31').localeCompare(b.dueOn ?? '9999-12-31')
    || a.title.localeCompare(b.title));
}

export function summarise(items: readonly ObligationItem[]): { overdue: number; dueSoon: number; upcoming: number; attention: number } {
  const overdue = items.filter((i) => i.status === 'overdue').length;
  const dueSoon = items.filter((i) => i.status === 'due_soon').length;
  const upcoming = items.filter((i) => i.status === 'upcoming').length;
  return { overdue, dueSoon, upcoming, attention: overdue + dueSoon };
}
