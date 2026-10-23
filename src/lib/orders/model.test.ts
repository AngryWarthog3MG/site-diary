import test from 'node:test';
import assert from 'node:assert/strict';
import { orderRef, statusLabel, summarise, watchDue, hoursOpen } from './model.ts';

test('references and per-kind status words', () => {
  assert.equal(orderRef(7), 'ORD-007');
  assert.equal(statusLabel('material', 'done'), 'Received');
  assert.equal(statusLabel('plant_issue', 'done'), 'Fixed');
  assert.equal(statusLabel('plant_issue', 'open'), 'Reported');
});
test('summary counts what is still to happen, and what is late', () => {
  const s = summarise([
    { kind: 'material', status: 'open', urgent: true, needed_by: '2026-09-14' },
    { kind: 'material', status: 'ordered', urgent: false, needed_by: null },
    { kind: 'material', status: 'done', urgent: true, needed_by: '2026-09-01' },
    { kind: 'plant_issue', status: 'open', urgent: false, needed_by: null },
    { kind: 'plant_issue', status: 'cancelled', urgent: false, needed_by: null },
  ], '2026-09-15');
  assert.deepEqual(s, { toOrder: 1, ordered: 1, issues: 1, urgent: 1, late: 1, done: 1 });
});

test('a watcher is told once, then reminded only after another interval since they last heard (R165)', () => {
  const raised = '2026-10-23T01:00:00Z';
  assert.equal(watchDue({ status: 'open', raised_at: raised, watchers_notified_at: null, last_reminded_at: null }, '2026-10-23T01:01:00Z', 6), 'first');
  assert.equal(watchDue({ status: 'open', raised_at: raised, watchers_notified_at: '2026-10-23T01:01:00Z', last_reminded_at: null }, '2026-10-23T06:59:00Z', 6), null);
  assert.equal(watchDue({ status: 'ordered', raised_at: raised, watchers_notified_at: '2026-10-23T01:01:00Z', last_reminded_at: null }, '2026-10-23T07:01:00Z', 6), 'reminder');
  assert.equal(watchDue({ status: 'open', raised_at: raised, watchers_notified_at: '2026-10-23T01:01:00Z', last_reminded_at: '2026-10-23T07:01:00Z' }, '2026-10-23T12:00:00Z', 6), null);
  assert.equal(watchDue({ status: 'open', raised_at: raised, watchers_notified_at: '2026-10-23T01:01:00Z', last_reminded_at: '2026-10-23T07:01:00Z' }, '2026-10-23T13:02:00Z', 6), 'reminder');
  assert.equal(watchDue({ status: 'done', raised_at: raised, watchers_notified_at: null, last_reminded_at: null }, '2026-10-24T01:00:00Z', 6), null);
  assert.equal(watchDue({ status: 'cancelled', raised_at: raised, watchers_notified_at: '2026-10-23T01:01:00Z', last_reminded_at: null }, '2026-10-24T01:00:00Z', 6), null);
  assert.equal(hoursOpen(raised, '2026-10-23T07:30:00Z'), 6);
});
