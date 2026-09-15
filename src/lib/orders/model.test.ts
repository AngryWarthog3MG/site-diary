import test from 'node:test';
import assert from 'node:assert/strict';
import { orderRef, statusLabel, summarise } from './model.ts';

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
