import test from 'node:test';
import assert from 'node:assert/strict';
import { injurySummary, daysSinceLastInjury, monthBuckets, overdue } from './stats.ts';

const today = '2026-09-14';
const inc = [
  { kind: 'injury', occurred_at: '2026-09-01T02:00:00Z', treatment: 'medical', status: 'closed', notifiable: false },
  { kind: 'injury', occurred_at: '2026-08-20T02:00:00Z', treatment: 'first_aid', status: 'closed', notifiable: false },
  { kind: 'near_miss', occurred_at: '2026-09-10T02:00:00Z', treatment: null, status: 'open', notifiable: false },
  { kind: 'hazard', occurred_at: '2026-07-03T02:00:00Z', treatment: null, status: 'closed', notifiable: true },
];
test('injuries split into medical-or-worse and first aid, with a rate that names its hours', () => {
  const s = injurySummary(inc, 20000);
  assert.deepEqual([s.mti, s.fai, s.nearMiss, s.hazards, s.notifiable], [1, 1, 1, 1, 1]);
  assert.equal(s.ratePerMillionHours, 50);
  assert.equal(injurySummary(inc, 0).ratePerMillionHours, null);
});
test('days since the last injury, and none ever', () => {
  assert.equal(daysSinceLastInjury(inc, today), 13);
  assert.equal(daysSinceLastInjury([], today), null);
});
test('month buckets are oldest first and never skip an empty month', () => {
  const b = monthBuckets(inc, today, 3);
  assert.deepEqual(b.map((x) => x.month), ['2026-07', '2026-08', '2026-09']);
  assert.equal(b[2].total, 2);
  assert.equal(b[1].injuries, 1);
});
test('overdue counts undone actions past their date', () => {
  assert.equal(overdue([{ due_on: '2026-09-01', done_at: null }, { due_on: '2026-09-01', done_at: '2026-09-02T00:00:00Z' }, { due_on: null, done_at: null }], today), 1);
});
