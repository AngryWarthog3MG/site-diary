import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actionStatus, sortActions, summarise, originHref, remindDue, type RegisterRow } from './model.ts';

const TODAY = '2026-11-02';
const row = (over: Partial<RegisterRow>): RegisterRow => ({
  origin: 'manual', id: 'x', org_id: 'o', project_id: 'p', record_id: null, record_ref: null, record_title: null,
  action: 'Do it', detail: null, priority: 'normal', owner_name: null, assigned_to: null, due_on: null,
  done_at: null, done_by: null, done_note: null, raised_by: 'u', raised_at: '2026-11-01T00:00:00Z', ...over,
});

test('status: overdue before today, due soon within a week, open after or undated, done when done', () => {
  assert.equal(actionStatus(row({ due_on: '2026-11-01' }), TODAY), 'overdue');
  assert.equal(actionStatus(row({ due_on: '2026-11-02' }), TODAY), 'due_soon');
  assert.equal(actionStatus(row({ due_on: '2026-11-09' }), TODAY), 'due_soon');
  assert.equal(actionStatus(row({ due_on: '2026-11-10' }), TODAY), 'open');
  assert.equal(actionStatus(row({}), TODAY), 'open');
  assert.equal(actionStatus(row({ due_on: '2026-10-01', done_at: '2026-10-02T00:00:00Z' }), TODAY), 'done');
});

test('sort: overdue first and oldest, then by due date with undated last, priority breaks a tie, done at the end newest first', () => {
  const rows = [
    row({ id: 'undated' }),
    row({ id: 'done-old', done_at: '2026-10-01T00:00:00Z' }),
    row({ id: 'soon', due_on: '2026-11-05' }),
    row({ id: 'late-2', due_on: '2026-10-20' }),
    row({ id: 'late-1', due_on: '2026-10-10' }),
    row({ id: 'soon-critical', due_on: '2026-11-05', priority: 'critical' }),
    row({ id: 'done-new', done_at: '2026-10-30T00:00:00Z' }),
    row({ id: 'later', due_on: '2026-12-01' }),
  ];
  assert.deepEqual(sortActions(rows, TODAY).map((r) => r.id), ['late-1', 'late-2', 'soon-critical', 'soon', 'later', 'undated', 'done-new', 'done-old']);
});

test('summary counts open, overdue, due soon, done, mine and critical', () => {
  const rows = [
    row({ due_on: '2026-10-01', assigned_to: 'me', priority: 'critical' }),
    row({ due_on: '2026-11-04' }),
    row({ assigned_to: 'me' }),
    row({ done_at: '2026-10-02T00:00:00Z', assigned_to: 'me' }),
  ];
  assert.deepEqual(summarise(rows, TODAY, 'me'), { open: 3, overdue: 1, dueSoon: 1, done: 1, mine: 2, critical: 1 });
  assert.equal(summarise(rows, TODAY, null).mine, 0);
});

test('the door to the record, and none for a manual action', () => {
  assert.equal(originHref(row({ origin: 'incident', record_id: 'r1' }), '?project=p'), '/incidents/r1?project=p');
  assert.equal(originHref(row({ origin: 'audit', record_id: 'r1' }), ''), '/audits/audit/r1');
  assert.equal(originHref(row({ origin: 'review', record_id: 'r1' }), ''), '/audits/review/r1');
  assert.equal(originHref(row({ origin: 'compliance', record_id: 'r1' }), ''), '/environment/evaluation/r1');
  assert.equal(originHref(row({ origin: 'manual' }), ''), null);
});

test('reminder: assigned and overdue or due within the week; never unassigned, undated or done', () => {
  assert.equal(remindDue(row({ assigned_to: 'me', due_on: '2026-10-30' }), TODAY), true);
  assert.equal(remindDue(row({ assigned_to: 'me', due_on: '2026-11-08' }), TODAY), true);
  assert.equal(remindDue(row({ assigned_to: 'me', due_on: '2026-11-20' }), TODAY), false);
  assert.equal(remindDue(row({ assigned_to: 'me' }), TODAY), false);
  assert.equal(remindDue(row({ due_on: '2026-10-30' }), TODAY), false);
  assert.equal(remindDue(row({ assigned_to: 'me', due_on: '2026-10-30', done_at: '2026-10-31T00:00:00Z' }), TODAY), false);
});
