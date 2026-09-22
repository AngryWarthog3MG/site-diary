/**
 * A job's setup board (README R92): what it starts with, stamped from the
 * company's templates. The arithmetic the board and the home card show —
 * progress, priority A open, document gaps, overdue — and the order the
 * board lists things in. Pure, relative imports only — node-tested.
 */
import { TEMPLATE_KINDS, type Priority, type TemplateKind } from '../templates/model.ts';

export type SetupStatus = 'open' | 'done' | 'not_applicable';
export const STATUS_LABEL: Record<SetupStatus, string> = { open: 'Open', done: 'Done', not_applicable: 'Not applicable' };

export interface SetupItem {
  id: string;
  template_item_id: string | null;
  module_key: string | null;
  kind: TemplateKind;
  category: string | null;
  title: string;
  detail: string | null;
  priority: Priority | null;
  owner_role: 'office' | 'site' | null;
  owner_name: string | null;
  due_offset_days: number | null;
  due_on: string | null;
  unit: string | null;
  par_level: number | null;
  folder_no: number | null;
  sort: number;
  origin: 'template' | 'manual' | 'contract';
  status: SetupStatus;
  status_note: string | null;
  evidence: string | null;
  done_at: string | null;
  done_by: string | null;
  /** The closeout decision (README R93): promoted into the templates, or left as a one-off. Null until decided. */
  promotion_decision: 'promoted' | 'one_off' | null;
  promoted_template_item_id: string | null;
  decided_at: string | null;
}

type Counted = Pick<SetupItem, 'kind' | 'status' | 'priority' | 'due_on' | 'category'>;

/** A due date from the start date and an offset in days — calendar arithmetic on the date strings, no zones. */
export function dueOn(startOn: string | null | undefined, offsetDays: number | null | undefined): string | null {
  if (!startOn || offsetDays == null) return null;
  const [y, m, d] = startOn.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d + offsetDays)).toISOString().slice(0, 10);
}

/** Open, and its day has passed. Both sides are YYYY-MM-DD, so string order is date order. */
export function isOverdue(it: Pick<SetupItem, 'status' | 'due_on'>, today: string): boolean {
  return it.status === 'open' && it.due_on != null && it.due_on < today;
}

export interface KindCount { open: number; done: number; not_applicable: number }
export interface CategoryProgress { category: string; total: number; done: number; percent: number }
export interface SetupSummary {
  byKind: Record<TemplateKind, KindCount>;
  /** Start gate progress: done over what applies (not-applicable items are out of the denominator). */
  startGate: { applies: number; done: number; percent: number | null; byCategory: CategoryProgress[] };
  priorityAOpen: number;
  /** Expected documents nothing has been filed against — the brief's v_document_gaps, read off the board. */
  documentGaps: number;
  overdue: number;
}

export function summarise(items: readonly Counted[], today: string): SetupSummary {
  const byKind = Object.fromEntries(TEMPLATE_KINDS.map((k) => [k, { open: 0, done: 0, not_applicable: 0 }])) as Record<TemplateKind, KindCount>;
  const cats = new Map<string, { total: number; done: number }>();
  let priorityAOpen = 0;
  let overdue = 0;
  for (const it of items) {
    byKind[it.kind][it.status] += 1;
    if (it.status === 'open' && it.priority === 'A') priorityAOpen += 1;
    if (isOverdue(it, today)) overdue += 1;
    if (it.kind === 'start_gate' && it.status !== 'not_applicable') {
      const key = it.category ?? 'Uncategorised';
      const c = cats.get(key) ?? { total: 0, done: 0 };
      c.total += 1;
      if (it.status === 'done') c.done += 1;
      cats.set(key, c);
    }
  }
  const applies = byKind.start_gate.open + byKind.start_gate.done;
  const done = byKind.start_gate.done;
  const byCategory = [...cats.entries()]
    .map(([category, c]) => ({ category, total: c.total, done: c.done, percent: Math.round((100 * c.done) / c.total) }))
    .sort((a, b) => a.category.localeCompare(b.category));
  return {
    byKind,
    startGate: { applies, done, percent: applies === 0 ? null : Math.round((100 * done) / applies), byCategory },
    priorityAOpen,
    documentGaps: byKind.document.open,
    overdue,
  };
}

const STATUS_ORDER: Record<SetupStatus, number> = { open: 0, done: 1, not_applicable: 2 };
const PRIORITY_ORDER = (p: Priority | null) => (p === 'A' ? 0 : p === 'B' ? 1 : p === 'C' ? 2 : 3);

/** Open first; within that, priority A before B before C, the soonest due first, then the template's order. */
export function orderSetup<T extends Pick<SetupItem, 'status' | 'priority' | 'due_on' | 'sort' | 'category' | 'title'>>(items: readonly T[]): T[] {
  return items.slice().sort((a, b) =>
    STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
    || PRIORITY_ORDER(a.priority) - PRIORITY_ORDER(b.priority)
    || (a.due_on ?? '9999').localeCompare(b.due_on ?? '9999')
    || a.sort - b.sort
    || (a.category ?? '').localeCompare(b.category ?? '')
    || a.title.localeCompare(b.title));
}
