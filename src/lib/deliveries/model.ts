/**
 * Deliveries (README R127): what is booked to arrive on a job and when, and the material orders waiting beside
 * them, laid on a calendar. Pure, relative imports only — node-tested. Nothing here invents a date: an order with no
 * needed-by day is not on the calendar, and a delivery is where its booking put it.
 */

export type DeliveryStatus = 'booked' | 'received' | 'cancelled';

export interface Delivery {
  id: string;
  project_id: string;
  booked_for: string;
  window_text: string | null;
  item: string;
  quantity: string | null;
  supplier: string | null;
  order_id: string | null;
  notes: string | null;
  status: DeliveryStatus;
  moved_from: string[];
  received_at: string | null;
  received_on_device_at: string | null;
  docket_ref: string | null;
  received_note: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  booked_by_name?: string | null;
  received_by_name?: string | null;
}

/** A material order with a needed-by day, read from the orders table — asked for or placed, not yet received. */
export interface OrderOnCalendar {
  id: string;
  project_id: string;
  seq: number;
  item: string;
  quantity: string | null;
  supplier: string | null;
  needed_by: string;
  status: 'open' | 'ordered';
  urgent: boolean;
}

export type Tone = 'booked' | 'today' | 'overdue' | 'received' | 'cancelled' | 'order';

export interface CalendarItem {
  kind: 'delivery' | 'order';
  id: string;
  projectId: string;
  projectCode: string;
  date: string;
  item: string;
  quantity: string | null;
  supplier: string | null;
  window: string | null;
  /** A delivery's status, or for an order whether it has been placed. */
  status: DeliveryStatus | 'requested' | 'ordered';
  tone: Tone;
  /** Days a delivery was booked for before this one. */
  movedFrom: string[];
  delivery?: Delivery;
  order?: OrderOnCalendar;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function monthOf(date: string): string { return date.slice(0, 7); }
export function monthLabel(month: string): string { return `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`; }
export function nextMonth(month: string): string { const [y, m] = month.split('-').map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; }
export function prevMonth(month: string): string { const [y, m] = month.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; }
export function monthStart(month: string): string { return `${month}-01`; }
export function monthEnd(month: string): string { return addDays(monthStart(nextMonth(month)), -1); }

/** The month asked for in the address; anything unreadable is this month. */
export function readMonth(param: string | undefined, today: string): string {
  return typeof param === 'string' && MONTH_RE.test(param) && Number(param.slice(5, 7)) >= 1 && Number(param.slice(5, 7)) <= 12 ? param : monthOf(today);
}

/** The Monday of the week a date falls in. */
function weekStart(date: string): string {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, dow === 0 ? -6 : 1 - dow);
}

/** The month as rows of seven days, Monday first, padded with the neighbouring months' days so every row is full. */
export function monthGrid(month: string): string[][] {
  const first = weekStart(monthStart(month));
  const last = monthEnd(month);
  const rows: string[][] = [];
  for (let d = first; d <= last; d = addDays(d, 7)) rows.push(Array.from({ length: 7 }, (_, i) => addDays(d, i)));
  return rows;
}

export function toneFor(d: Pick<Delivery, 'status' | 'booked_for'>, today: string): Tone {
  if (d.status === 'received') return 'received';
  if (d.status === 'cancelled') return 'cancelled';
  if (d.booked_for < today) return 'overdue';
  return d.booked_for === today ? 'today' : 'booked';
}

/**
 * Everything on the calendar: each delivery where it is booked, and each unfinished material order on its needed-by
 * day — unless a delivery already points at that order, in which case the booking is the truth and the order is
 * not shown twice. Sorted by day, then deliveries before orders, then by item.
 */
export function calendarItems(
  deliveries: readonly Delivery[],
  orders: readonly OrderOnCalendar[],
  today: string,
  codeOf: (projectId: string) => string,
): CalendarItem[] {
  const booked = new Set(deliveries.filter((d) => d.order_id && d.status !== 'cancelled').map((d) => d.order_id as string));
  const items: CalendarItem[] = deliveries.map((d) => ({
    kind: 'delivery', id: d.id, projectId: d.project_id, projectCode: codeOf(d.project_id), date: d.booked_for,
    item: d.item, quantity: d.quantity, supplier: d.supplier, window: d.window_text, status: d.status,
    tone: toneFor(d, today), movedFrom: d.moved_from ?? [], delivery: d,
  }));
  for (const o of orders) {
    if (booked.has(o.id) || !DATE_RE.test(o.needed_by)) continue;
    items.push({
      kind: 'order', id: o.id, projectId: o.project_id, projectCode: codeOf(o.project_id), date: o.needed_by,
      item: o.item, quantity: o.quantity, supplier: o.supplier, window: null, status: o.status === 'ordered' ? 'ordered' : 'requested',
      tone: 'order', movedFrom: [], order: o,
    });
  }
  return items.sort((a, b) => a.date.localeCompare(b.date) || (a.kind === b.kind ? 0 : a.kind === 'delivery' ? -1 : 1) || a.item.localeCompare(b.item));
}

export function byDay(items: readonly CalendarItem[]): Map<string, CalendarItem[]> {
  const m = new Map<string, CalendarItem[]>();
  for (const it of items) { const l = m.get(it.date); if (l) l.push(it); else m.set(it.date, [it]); }
  return m;
}

export function forDay(items: readonly CalendarItem[], date: string): CalendarItem[] {
  return items.filter((it) => it.date === date);
}

export interface DeliverySummary {
  /** Booked deliveries in the month, however they end. */
  inMonth: number;
  today: number;
  tomorrow: number;
  /** Booked for a day gone by and neither received nor cancelled. */
  overdue: number;
  received: number;
  /** Material orders on the calendar in the month, not yet booked as a delivery. */
  ordersWaiting: number;
}

export function summarise(items: readonly CalendarItem[], today: string, month: string): DeliverySummary {
  const inMonth = items.filter((it) => monthOf(it.date) === month);
  const del = (list: readonly CalendarItem[]) => list.filter((it) => it.kind === 'delivery');
  return {
    inMonth: del(inMonth).length,
    today: del(items).filter((it) => it.date === today && it.status === 'booked').length,
    tomorrow: del(items).filter((it) => it.date === addDays(today, 1) && it.status === 'booked').length,
    overdue: del(items).filter((it) => it.tone === 'overdue').length,
    received: del(inMonth).filter((it) => it.status === 'received').length,
    ordersWaiting: inMonth.filter((it) => it.kind === 'order').length,
  };
}

/** "Plants for PG1 · 400 · Benara Nurseries · AM" — one line for a chip or a row. */
export function describe(it: Pick<CalendarItem, 'item' | 'quantity' | 'supplier' | 'window'>): string {
  return [it.item, it.quantity, it.supplier, it.window].filter((v) => v && v.trim()).join(' · ');
}
