/**
 * Orders and plant issues, as facts. What a supervisor thinks of on site and
 * the office has to act on: diesel, consumables, a part, anything — and a
 * fault on a machine that is not yet a prestart defect. Pure, so the list,
 * the home card and a tender answer agree.
 */
export const ORDER_KINDS = ['material', 'plant_issue'] as const;
export type OrderKind = (typeof ORDER_KINDS)[number];
export const KIND_LABEL: Record<OrderKind, string> = { material: 'Order', plant_issue: 'Plant issue' };
export const KIND_HINT: Record<OrderKind, string> = {
  material: 'Diesel, consumables, a part, anything the job needs',
  plant_issue: 'A fault on a machine — a light out, a beeper not working',
};

export const ORDER_STATUSES = ['open', 'ordered', 'done', 'cancelled'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
/** The status word, per kind: an order is ordered then received; an issue is open then fixed. */
export function statusLabel(kind: OrderKind, status: OrderStatus): string {
  if (status === 'open') return kind === 'plant_issue' ? 'Reported' : 'To order';
  if (status === 'ordered') return kind === 'plant_issue' ? 'Booked in' : 'Ordered';
  if (status === 'done') return kind === 'plant_issue' ? 'Fixed' : 'Received';
  return 'Cancelled';
}

export function orderRef(seq: number): string {
  return `ORD-${String(seq).padStart(3, '0')}`;
}

export interface OrderFacts { kind: OrderKind; status: OrderStatus; urgent: boolean; needed_by: string | null }

export interface OrderSummary { toOrder: number; ordered: number; issues: number; urgent: number; late: number; done: number }

/** The counts the list and the home card show. `late` = open or ordered, needed by a date already past. */
export function summarise(rows: readonly OrderFacts[], today: string): OrderSummary {
  const live = rows.filter((r) => r.status === 'open' || r.status === 'ordered');
  return {
    toOrder: rows.filter((r) => r.kind === 'material' && r.status === 'open').length,
    ordered: rows.filter((r) => r.kind === 'material' && r.status === 'ordered').length,
    issues: rows.filter((r) => r.kind === 'plant_issue' && r.status !== 'done' && r.status !== 'cancelled').length,
    urgent: live.filter((r) => r.urgent).length,
    late: live.filter((r) => r.needed_by != null && r.needed_by < today).length,
    done: rows.filter((r) => r.status === 'done').length,
  };
}

export const isFinished = (status: OrderStatus) => status === 'done' || status === 'cancelled';

export interface WatchFacts { status: OrderStatus; raised_at: string; watchers_notified_at: string | null; last_reminded_at: string | null }

/**
 * What the watchers are owed about a request right now (README R165): the first word of it, a reminder because it has
 * sat open or ordered for another `everyHours` since they last heard, or nothing. A finished request owes nothing.
 * Counted from when they were last told, never from a round clock, so a request raised at 11:59 is not reminded at
 * 12:00. Pure.
 */
export function watchDue(o: WatchFacts, nowIso: string, everyHours: number): 'first' | 'reminder' | null {
  if (isFinished(o.status)) return null;
  if (!o.watchers_notified_at) return 'first';
  const last = Date.parse(o.last_reminded_at ?? o.watchers_notified_at);
  if (!Number.isFinite(last)) return 'first';
  return Date.parse(nowIso) - last >= everyHours * 3_600_000 ? 'reminder' : null;
}

/** Whole hours a request has been open, for the reminder's words. */
export function hoursOpen(raisedAt: string, nowIso: string): number {
  return Math.max(0, Math.floor((Date.parse(nowIso) - Date.parse(raisedAt)) / 3_600_000));
}
