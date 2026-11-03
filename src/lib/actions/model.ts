/**
 * The action register (README R177): every action the app raises, from whatever
 * record, in one shape — and the manual ones with no record behind them.
 *
 * Pure and dependency-free: the screen, the home card, the Safety dashboard
 * and the nightly reminder all sort and count the same way. Dates are ISO
 * calendar days in Perth; nothing here reads a clock.
 */

export const ACTION_ORIGINS = ['manual', 'incident', 'inspection', 'form', 'asset', 'audit', 'review', 'compliance'] as const;
export type ActionOrigin = (typeof ACTION_ORIGINS)[number];

export const ORIGIN_LABEL: Record<ActionOrigin, string> = {
  manual: 'Raised by hand',
  incident: 'Hazard or incident',
  inspection: 'Inspection',
  form: 'Form answer',
  asset: 'Asset falling due',
  audit: 'Audit finding',
  review: 'Management review',
  compliance: 'Compliance evaluation',
};

export const ACTION_PRIORITIES = ['critical', 'high', 'normal'] as const;
export type ActionPriority = (typeof ACTION_PRIORITIES)[number];
export const PRIORITY_LABEL: Record<ActionPriority, string> = { critical: 'Critical', high: 'High', normal: 'Normal' };
const PRIORITY_RANK: Record<ActionPriority, number> = { critical: 0, high: 1, normal: 2 };

/** A row of `public.action_register`, as the view returns it. */
export interface RegisterRow {
  origin: ActionOrigin;
  id: string;
  org_id: string;
  project_id: string | null;
  record_id: string | null;
  record_ref: string | null;
  record_title: string | null;
  action: string;
  detail: string | null;
  priority: ActionPriority;
  owner_name: string | null;
  assigned_to: string | null;
  due_on: string | null;
  done_at: string | null;
  done_by: string | null;
  done_note: string | null;
  raised_by: string | null;
  raised_at: string;
}

export type ActionStatus = 'overdue' | 'due_soon' | 'open' | 'done';
export const STATUS_LABEL: Record<ActionStatus, string> = { overdue: 'Overdue', due_soon: 'Due this week', open: 'Open', done: 'Done' };

/** Within this many days of due counts as "due soon". A week: the reminder and the chip agree. */
export const DUE_SOON_DAYS = 7;

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function actionStatus(a: Pick<RegisterRow, 'due_on' | 'done_at'>, today: string): ActionStatus {
  if (a.done_at != null) return 'done';
  if (a.due_on == null) return 'open';
  if (a.due_on < today) return 'overdue';
  if (a.due_on <= addDays(today, DUE_SOON_DAYS)) return 'due_soon';
  return 'open';
}

/**
 * The order the register lists them in: overdue first (the longest overdue at the top), then due soon, then the
 * rest by due date with the undated last; within a day, the higher priority first; done ones after everything,
 * the most recently done first. Stable for equal keys, so a reload does not reshuffle.
 */
export function sortActions<T extends Pick<RegisterRow, 'due_on' | 'done_at' | 'priority' | 'raised_at'>>(rows: readonly T[], today: string): T[] {
  const rank: Record<ActionStatus, number> = { overdue: 0, due_soon: 1, open: 2, done: 3 };
  return [...rows].sort((a, b) => {
    const sa = actionStatus(a, today); const sb = actionStatus(b, today);
    if (sa !== sb) return rank[sa] - rank[sb];
    if (sa === 'done') return (b.done_at ?? '').localeCompare(a.done_at ?? '');
    const da = a.due_on ?? '9999-12-31'; const db = b.due_on ?? '9999-12-31';
    if (da !== db) return da.localeCompare(db);
    if (a.priority !== b.priority) return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    return a.raised_at.localeCompare(b.raised_at);
  });
}

export interface ActionSummary { open: number; overdue: number; dueSoon: number; done: number; mine: number; critical: number }

/** The counts the screen and the home card show. `mine` is what is assigned to this account and still open. */
export function summarise(rows: readonly Pick<RegisterRow, 'due_on' | 'done_at' | 'priority' | 'assigned_to'>[], today: string, userId: string | null): ActionSummary {
  const s: ActionSummary = { open: 0, overdue: 0, dueSoon: 0, done: 0, mine: 0, critical: 0 };
  for (const r of rows) {
    const st = actionStatus(r, today);
    if (st === 'done') { s.done += 1; continue; }
    s.open += 1;
    if (st === 'overdue') s.overdue += 1;
    if (st === 'due_soon') s.dueSoon += 1;
    if (r.priority === 'critical') s.critical += 1;
    if (userId && r.assigned_to === userId) s.mine += 1;
  }
  return s;
}

/** Where the record behind an action lives; a manual action has no page but the register. */
export function originHref(a: Pick<RegisterRow, 'origin' | 'record_id' | 'project_id'>, q: string): string | null {
  if (!a.record_id) return null;
  switch (a.origin) {
    case 'incident': return `/incidents/${a.record_id}${q}`;
    case 'inspection': return `/inspections/${a.record_id}${q}`;
    case 'form': return `/forms/${a.record_id}${q}`;
    case 'asset': return `/assets/${a.record_id}${q}`;
    case 'audit': return `/audits/audit/${a.record_id}${q}`;
    case 'review': return `/audits/review/${a.record_id}${q}`;
    case 'compliance': return `/environment/evaluation/${a.record_id}${q}`;
    default: return null;
  }
}

/**
 * The nightly reminder's rule: an assigned, open action is pushed to its assignee when it is overdue or due within
 * the week. The cron runs once a day, so that is once a day while it stands — no stamp needed.
 */
export function remindDue(a: Pick<RegisterRow, 'due_on' | 'done_at' | 'assigned_to'>, today: string): boolean {
  if (!a.assigned_to) return false;
  const st = actionStatus(a, today);
  return st === 'overdue' || st === 'due_soon';
}
