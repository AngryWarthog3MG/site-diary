import test from 'node:test';
import assert from 'node:assert/strict';
import { incidentRef, actionOverdue, summarise, urgent } from './model.ts';

test('reports are numbered INC-001 style', () => {
  assert.equal(incidentRef(7), 'INC-007');
  assert.equal(incidentRef(123), 'INC-123');
});

test('an action is overdue only while not done and past its date', () => {
  assert.equal(actionOverdue({ due_on: '2026-09-10', done_at: null }, '2026-09-14'), true);
  assert.equal(actionOverdue({ due_on: '2026-09-14', done_at: null }, '2026-09-14'), false);
  assert.equal(actionOverdue({ due_on: '2026-09-10', done_at: '2026-09-11T00:00:00Z' }, '2026-09-14'), false);
  assert.equal(actionOverdue({ due_on: null, done_at: null }, '2026-09-14'), false);
});

test('the register summary counts by status and kind', () => {
  const s = summarise([
    { kind: 'hazard', status: 'open', notifiable: false, occurred_at: '' },
    { kind: 'injury', status: 'investigating', notifiable: true, occurred_at: '' },
    { kind: 'hazard', status: 'closed', notifiable: false, occurred_at: '' },
  ]);
  assert.deepEqual([s.open, s.investigating, s.closed, s.notifiable], [1, 1, 1, 1]);
  assert.deepEqual(s.byKind, [{ kind: 'hazard', count: 2 }, { kind: 'injury', count: 1 }]);
});

test('the office hears at once about injuries, notifiable and high-severity reports', () => {
  assert.equal(urgent({ kind: 'hazard', notifiable: false, actual_severity: 'low', potential_severity: 'medium' }), false);
  assert.equal(urgent({ kind: 'injury', notifiable: false, actual_severity: null, potential_severity: null }), true);
  assert.equal(urgent({ kind: 'near_miss', notifiable: false, actual_severity: null, potential_severity: 'extreme' }), true);
  assert.equal(urgent({ kind: 'hazard', notifiable: true, actual_severity: null, potential_severity: null }), true);
});
