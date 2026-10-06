import { test } from 'node:test';
import assert from 'node:assert/strict';
import { byDay, calendarItems, describe, forDay, monthEnd, monthGrid, nextMonth, prevMonth, readMonth, summarise, toneFor, type Delivery, type OrderOnCalendar } from './model.ts';

const TODAY = '2026-10-06';
const d = (over: Partial<Delivery>): Delivery => ({
  id: 'd1', project_id: 'p1', booked_for: '2026-10-12', window_text: 'AM', item: 'Plants for PG1', quantity: '400', supplier: 'Benara Nurseries',
  order_id: null, notes: null, status: 'booked', moved_from: [], received_at: null, received_on_device_at: null, docket_ref: null, received_note: null,
  cancelled_at: null, cancel_reason: null, ...over,
});
const o = (over: Partial<OrderOnCalendar>): OrderOnCalendar => ({ id: 'o1', project_id: 'p1', seq: 3, item: 'Mulch 20 m3', quantity: null, supplier: null, needed_by: '2026-10-09', status: 'ordered', urgent: false, ...over });
const code = (p: string) => (p === 'p1' ? 'C001' : 'C002');

test('the month grid is whole weeks, Monday first', () => {
  const g = monthGrid('2026-10');
  assert.equal(g[0][0], '2026-09-28');
  assert.equal(g[0][3], '2026-10-01');
  assert.equal(g.at(-1)![6], '2026-11-01');
  assert.ok(g.every((w) => w.length === 7));
  assert.equal(monthEnd('2026-10'), '2026-10-31');
  assert.equal(nextMonth('2026-12'), '2027-01');
  assert.equal(prevMonth('2026-01'), '2025-12');
  assert.equal(readMonth('2026-11', TODAY), '2026-11');
  assert.equal(readMonth('2026-13', TODAY), '2026-10');
  assert.equal(readMonth(undefined, TODAY), '2026-10');
});

test('a delivery is booked, today, overdue, received or cancelled by its day and status', () => {
  assert.equal(toneFor({ status: 'booked', booked_for: '2026-10-12' }, TODAY), 'booked');
  assert.equal(toneFor({ status: 'booked', booked_for: TODAY }, TODAY), 'today');
  assert.equal(toneFor({ status: 'booked', booked_for: '2026-10-01' }, TODAY), 'overdue');
  assert.equal(toneFor({ status: 'received', booked_for: '2026-10-01' }, TODAY), 'received');
  assert.equal(toneFor({ status: 'cancelled', booked_for: '2026-10-12' }, TODAY), 'cancelled');
});

test('orders sit on their needed-by day unless a delivery already books them; order within a day is deliveries first', () => {
  const items = calendarItems(
    [d({}), d({ id: 'd2', booked_for: '2026-10-09', item: 'Mulch', order_id: 'o1' }), d({ id: 'd3', booked_for: '2026-10-09', item: 'Sand', project_id: 'p2' })],
    [o({}), o({ id: 'o2', item: 'Pipe', needed_by: '2026-10-09', status: 'open' })],
    TODAY, code,
  );
  assert.deepEqual(items.map((it) => `${it.date} ${it.kind} ${it.item} ${it.projectCode} ${it.status}`), [
    '2026-10-09 delivery Mulch C001 booked',
    '2026-10-09 delivery Sand C002 booked',
    '2026-10-09 order Pipe C001 requested',
    '2026-10-12 delivery Plants for PG1 C001 booked',
  ]);
  assert.equal(byDay(items).get('2026-10-09')?.length, 3);
  assert.deepEqual(forDay(items, '2026-10-12').map((it) => it.item), ['Plants for PG1']);
  assert.equal(describe(items[3]), 'Plants for PG1 · 400 · Benara Nurseries · AM');
  assert.equal(describe({ item: 'Sand', quantity: null, supplier: ' ', window: null }), 'Sand');
});

test('the figures: this month, today, tomorrow, overdue, received, orders waiting', () => {
  const items = calendarItems(
    [d({}), d({ id: 'd2', booked_for: TODAY, item: 'Diesel' }), d({ id: 'd3', booked_for: '2026-10-07', item: 'Fuel' }),
      d({ id: 'd4', booked_for: '2026-10-02', item: 'Late sand' }), d({ id: 'd5', booked_for: '2026-10-01', item: 'Got it', status: 'received', received_at: '2026-10-01T02:00:00Z' }),
      d({ id: 'd6', booked_for: '2026-11-03', item: 'Next month' })],
    [o({ needed_by: '2026-10-20' }), o({ id: 'o9', needed_by: '2026-11-20' })],
    TODAY, code,
  );
  assert.deepEqual(summarise(items, TODAY, '2026-10'), { inMonth: 5, today: 1, tomorrow: 1, overdue: 1, received: 1, ordersWaiting: 1 });
});
