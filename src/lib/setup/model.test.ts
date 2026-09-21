import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dueOn, isOverdue, orderSetup, summarise } from './model.ts';

const row = (over: Partial<Parameters<typeof orderSetup>[0][number]> & { kind?: string; status?: string; priority?: string | null; due_on?: string | null; category?: string | null }) => ({
  kind: 'start_gate', status: 'open', priority: null, due_on: null, category: null, sort: 100, title: 'x', ...over,
}) as never;

test('due dates count from the start date by calendar days, across a month end', () => {
  assert.equal(dueOn('2026-10-05', -7), '2026-09-28');
  assert.equal(dueOn('2026-10-05', 0), '2026-10-05');
  assert.equal(dueOn('2026-12-30', 5), '2027-01-04');
  assert.equal(dueOn(null, 5), null);
  assert.equal(dueOn('2026-10-05', null), null);
});

test('overdue is open and past, by date string', () => {
  assert.equal(isOverdue({ status: 'open', due_on: '2026-09-20' }, '2026-09-21'), true);
  assert.equal(isOverdue({ status: 'open', due_on: '2026-09-21' }, '2026-09-21'), false);
  assert.equal(isOverdue({ status: 'done', due_on: '2026-09-01' }, '2026-09-21'), false);
  assert.equal(isOverdue({ status: 'open', due_on: null }, '2026-09-21'), false);
});

test('the summary counts by kind, progress over what applies, priority A open, document gaps and overdue', () => {
  const s = summarise([
    row({ kind: 'start_gate', status: 'done', priority: 'A', category: 'Contract' }),
    row({ kind: 'start_gate', status: 'open', priority: 'A', category: 'Contract', due_on: '2026-09-01' }),
    row({ kind: 'start_gate', status: 'open', priority: 'B', category: 'Insurance' }),
    row({ kind: 'start_gate', status: 'not_applicable', priority: 'B', category: 'Remote' }),
    row({ kind: 'document', status: 'open' }),
    row({ kind: 'document', status: 'done' }),
    row({ kind: 'hold_point', status: 'open', priority: 'A' }),
  ], '2026-09-21');
  assert.deepEqual(s.byKind.start_gate, { open: 2, done: 1, not_applicable: 1 });
  assert.equal(s.startGate.applies, 3);
  assert.equal(s.startGate.percent, 33);
  assert.deepEqual(s.startGate.byCategory, [
    { category: 'Contract', total: 2, done: 1, percent: 50 },
    { category: 'Insurance', total: 1, done: 0, percent: 0 },
  ]);
  assert.equal(s.priorityAOpen, 2);
  assert.equal(s.documentGaps, 1);
  assert.equal(s.overdue, 1);
  assert.equal(summarise([], '2026-09-21').startGate.percent, null);
});

test('open first, then A before C, soonest due first, then the template order', () => {
  const rows = [
    row({ title: 'done', status: 'done', priority: 'A' }),
    row({ title: 'c-open', priority: 'C' }),
    row({ title: 'a-late', priority: 'A', due_on: '2026-10-01' }),
    row({ title: 'a-soon', priority: 'A', due_on: '2026-09-25' }),
    row({ title: 'a-nodate', priority: 'A' }),
    row({ title: 'na', status: 'not_applicable', priority: 'A' }),
  ];
  assert.deepEqual(orderSetup(rows).map((r: { title: string }) => r.title), ['a-soon', 'a-late', 'a-nodate', 'c-open', 'done', 'na']);
});
