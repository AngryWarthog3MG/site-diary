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
