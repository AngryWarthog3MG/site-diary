/**
 * The regulator trail for a notifiable incident, read off its events.
 *
 * WHS Act 2020 (WA) s. 38: notify "immediately after becoming aware"; where
 * notice was by phone the regulator may require written notice within 48 hours
 * of that requirement being made; keep the record at least five years from the
 * day notice was given. s. 39: leave the site undisturbed until an inspector
 * arrives or directs otherwise.
 *
 * Pure and dependency-free. It never decides whether an incident IS notifiable
 * — that is a person's call, recorded on the report or as a 'became_aware'
 * event — it only says what that call now requires and whether it was met.
 */

export const REGULATOR_EVENT_KINDS = [
  'became_aware', 'notified', 'written_notice_required', 'written_notice_given', 'site_preserved', 'site_released',
] as const;
export type RegulatorEventKind = (typeof REGULATOR_EVENT_KINDS)[number];

export const EVENT_LABEL: Record<RegulatorEventKind, string> = {
  became_aware: 'Became aware it is notifiable',
  notified: 'WorkSafe WA notified',
  written_notice_required: 'WorkSafe required written notice',
  written_notice_given: 'Written notice given',
  site_preserved: 'Site left undisturbed',
  site_released: 'Site released by an inspector',
};

export const METHODS = ['phone', 'online', 'in_person', 'email'] as const;
export type Method = (typeof METHODS)[number];
export const METHOD_LABEL: Record<Method, string> = { phone: 'by phone', online: 'online', in_person: 'in person', email: 'by email' };

/** s. 38(4)(b): written notice within 48 hours of the regulator's requirement. */
export const WRITTEN_NOTICE_HOURS = 48;
/** s. 38(7): keep the record at least five years from the day notice was given. */
export const RETENTION_YEARS = 5;

export interface RegulatorEvent {
  id: string;
  kind: RegulatorEventKind;
  happened_at: string;
  method: Method | null;
  person_name: string | null;
  detail: string | null;
}

export interface RegulatorState {
  /** Whether the regulator duties apply: the report says notifiable, or someone later recorded becoming aware. */
  applies: boolean;
  becameAwareAt: string | null;
  notifiedAt: string | null;
  notifiedMethod: Method | null;
  /** Whole minutes from becoming aware to notifying; null until both are recorded. */
  minutesToNotify: number | null;
  writtenNoticeDueAt: string | null;
  writtenNoticeGivenAt: string | null;
  writtenNoticeOverdue: boolean;
  preservedAt: string | null;
  dutyHolder: string | null;
  releasedAt: string | null;
  /** The earliest day the record may be let go, s. 38(7); null until notice is given. */
  keepUntil: string | null;
  /** What still has to happen, in plain words, in the order it matters. */
  outstanding: string[];
}

function first(events: readonly RegulatorEvent[], kind: RegulatorEventKind): RegulatorEvent | null {
  const of = events.filter((e) => e.kind === kind);
  if (of.length === 0) return null;
  return of.reduce((a, b) => (a.happened_at <= b.happened_at ? a : b));
}

function latest(events: readonly RegulatorEvent[], kind: RegulatorEventKind): RegulatorEvent | null {
  const of = events.filter((e) => e.kind === kind);
  if (of.length === 0) return null;
  return of.reduce((a, b) => (a.happened_at >= b.happened_at ? a : b));
}

/** The Perth calendar day of an instant, formatted by hand (no locale APIs). */
export function perthDay(iso: string): string {
  const t = Date.parse(iso) + 8 * 3_600_000;
  return new Date(t).toISOString().slice(0, 10);
}

function addYearsToDay(day: string, years: number): string {
  const y = Number(day.slice(0, 4)) + years;
  const md = day.slice(4);
  if (md === '-02-29') {
    const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    if (!leap) return `${y}-02-28`;
  }
  return `${y}${md}`;
}

export function regulatorState(reportSaysNotifiable: boolean, events: readonly RegulatorEvent[], now: string): RegulatorState {
  const aware = first(events, 'became_aware');
  const notified = first(events, 'notified');
  const required = latest(events, 'written_notice_required');
  const given = required ? events.filter((e) => e.kind === 'written_notice_given' && e.happened_at >= required.happened_at)
    .reduce<RegulatorEvent | null>((a, b) => (a == null || b.happened_at < a.happened_at ? b : a), null) : null;
  const preserved = first(events, 'site_preserved');
  const released = latest(events, 'site_released');

  const applies = reportSaysNotifiable || aware != null || notified != null;
  const minutesToNotify = aware && notified
    ? Math.max(0, Math.round((Date.parse(notified.happened_at) - Date.parse(aware.happened_at)) / 60_000))
    : null;
  const writtenNoticeDueAt = required
    ? new Date(Date.parse(required.happened_at) + WRITTEN_NOTICE_HOURS * 3_600_000).toISOString()
    : null;
  const writtenNoticeOverdue = Boolean(writtenNoticeDueAt && !given && Date.parse(now) > Date.parse(writtenNoticeDueAt));
  const keepUntil = notified ? addYearsToDay(perthDay(notified.happened_at), RETENTION_YEARS) : null;

  const outstanding: string[] = [];
  if (applies) {
    if (!aware) outstanding.push('Record when the business became aware it was notifiable.');
    if (!notified) outstanding.push('Notify WorkSafe WA now — phone 1800 678 198, 24 hours.');
    if (required && !given) outstanding.push(writtenNoticeOverdue ? 'Written notice is overdue.' : 'Give the written notice WorkSafe required.');
    if (!preserved && !released) outstanding.push('Record that the site is left undisturbed, and who holds that duty.');
  }

  return {
    applies,
    becameAwareAt: aware?.happened_at ?? null,
    notifiedAt: notified?.happened_at ?? null,
    notifiedMethod: notified?.method ?? null,
    minutesToNotify,
    writtenNoticeDueAt,
    writtenNoticeGivenAt: given?.happened_at ?? null,
    writtenNoticeOverdue,
    preservedAt: preserved?.happened_at ?? null,
    dutyHolder: preserved?.person_name ?? null,
    releasedAt: released?.happened_at ?? null,
    keepUntil,
    outstanding,
  };
}
