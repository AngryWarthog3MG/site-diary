import { test } from 'node:test';
import assert from 'node:assert/strict';
import { itemValue, summariseRegister } from './register.ts';

test('an item is worth what was agreed, else what was estimated, else nothing', () => {
  assert.equal(itemValue({ estimated_cost: 800, agreed_cost: 1250 }), 1250);
  assert.equal(itemValue({ estimated_cost: 800, agreed_cost: null }), 800);
  assert.equal(itemValue({ estimated_cost: null, agreed_cost: null }), null);
});

test('not yet submitted is raised plus priced; approved-unpaid is the money owed', () => {
  const s = summariseRegister([
    { status: 'raised', estimated_cost: 500, agreed_cost: null },
    { status: 'priced', estimated_cost: 1200, agreed_cost: null },
    { status: 'submitted', estimated_cost: 900, agreed_cost: null },
    { status: 'approved', estimated_cost: 900, agreed_cost: 850 },
    { status: 'paid', estimated_cost: null, agreed_cost: 2000 },
    { status: 'raised', estimated_cost: null, agreed_cost: null },
  ]);
  assert.deepEqual(s.notSubmitted, { count: 3, value: 1700 });
  assert.deepEqual(s.approvedUnpaid, { count: 1, value: 850 });
  assert.equal(s.total, 6);
  assert.deepEqual(s.byStatus.find((b) => b.status === 'raised'), { status: 'raised', count: 2, value: 500 });
  assert.deepEqual(s.byStatus.find((b) => b.status === 'rejected'), { status: 'rejected', count: 0, value: 0 });
});

import { stageDates, waitingOn, nextFreeNumber, trackerOrder, daysBetween } from './register.ts';

const base = {
  id: 'x', seq: 1, title: 'T', vr_ref: null, raised_on: '2026-09-01', status: 'raised' as const, estimated_cost: null, agreed_cost: null,
  submitted_on: null, decided_on: null, paid_on: null, notes: null, signed: true, crew: [], hours: 0,
  mentions: [{ date: '2026-09-01', entry_no: 'X-1', entry_id: 'e', signed: true, hours: null, description: null, crew: [] }],
  events: [] as Array<{ status: 'raised' | 'priced' | 'submitted' | 'approved' | 'rejected' | 'paid'; note: string | null; at: string; by: string | null }>,
};
test('what a variation is waiting on, in the order a PM acts', () => {
  const today = '2026-09-15';
  assert.deepEqual(waitingOn({ ...base, signed: false }, today), { text: 'Sign the day that records it', tone: 'act' });
  assert.equal(waitingOn(base, today).text, 'Put a value on it');
  assert.equal(waitingOn({ ...base, estimated_cost: 500 }, today).text, 'Price it · 14 days');
  assert.equal(waitingOn({ ...base, status: 'priced', estimated_cost: 500 }, today).text, 'Send it to the client — it has no client ref yet');
  const sub = waitingOn({ ...base, status: 'submitted', agreed_cost: 500, submitted_on: '2026-08-20' }, today);
  assert.equal(sub.tone, 'act', 'more than a fortnight with the client is a chase');
  assert.equal(sub.text, 'With the client since 20/08 · 26 days');
  assert.equal(waitingOn({ ...base, status: 'approved', agreed_cost: 500, decided_on: '2026-09-14' }, today).text, 'Approved 14/09 — invoice it · 1 day');
  assert.deepEqual(waitingOn({ ...base, status: 'paid', agreed_cost: 500, paid_on: '2026-09-10' }, today), { text: 'Paid 10/09', tone: 'ok' });
  assert.equal(waitingOn({ ...base, mentions: [] }, today).tone, 'stop');
});
test('stage dates come from the ledger first, the item dates second, and stop at the stage reached', () => {
  const d = stageDates({ ...base, status: 'submitted', submitted_on: '2026-09-10', events: [{ status: 'priced', note: null, at: '2026-09-05T02:00:00Z', by: null }, { status: 'submitted', note: null, at: '2026-09-09T02:00:00Z', by: null }] });
  assert.equal(d.raised, '2026-09-01');
  assert.equal(d.priced, '2026-09-05');
  assert.equal(d.submitted, '2026-09-09', 'the ledger beats the date column');
  assert.equal(d.approved, null);
  assert.equal(d.paid, null);
});
test('next free number and the tracker order', () => {
  assert.equal(nextFreeNumber([{ seq: 1 }, { seq: 2 }, { seq: 4 }]), 3);
  const ordered = trackerOrder([
    { ...base, seq: 1, status: 'paid' as const, agreed_cost: 1, paid_on: '2026-09-01' },
    { ...base, seq: 2, status: 'submitted' as const, agreed_cost: 1, submitted_on: '2026-09-14' },
    { ...base, seq: 3 },
  ], '2026-09-15');
  assert.deepEqual(ordered.map((i) => i.seq), [3, 2, 1]);
  assert.equal(daysBetween('2026-09-01', '2026-09-15T08:00:00Z'), 14);
});
