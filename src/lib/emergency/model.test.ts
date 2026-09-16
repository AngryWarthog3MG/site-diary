import { test } from 'node:test';
import assert from 'node:assert/strict';
import { currentPlan, nextDrillDue, lastDrill, perthDayOf } from './model.ts';

const plan = (version: number, issued_at: string, test_every_months = 6) => ({ id: `p${version}`, version, issued_at, test_every_months });

test('the plan in force is the highest version, whatever order they come in', () => {
  assert.equal(currentPlan([plan(2, '2026-05-01T00:00:00Z'), plan(3, '2026-08-01T00:00:00Z'), plan(1, '2026-01-01T00:00:00Z')])?.version, 3);
  assert.equal(currentPlan([]), null);
});

test('with no drill yet, the first test is due the stated months after the plan was issued, in Perth', () => {
  // 18:00 UTC on 31 March is 02:00 on 1 April in Perth.
  assert.equal(perthDayOf('2026-03-31T18:00:00Z'), '2026-04-01');
  assert.equal(nextDrillDue(plan(1, '2026-03-31T18:00:00Z', 6), []), '2026-10-01');
});

test('after a drill, the next is due the stated months after the last one held', () => {
  const drills = [
    { id: 'd1', plan_id: 'p1', held_on: '2026-02-10' },
    { id: 'd2', plan_id: 'p1', held_on: '2026-08-20' },
  ];
  assert.equal(lastDrill(drills)?.id, 'd2');
  assert.equal(nextDrillDue(plan(1, '2026-01-01T00:00:00Z', 6), drills), '2027-02-20');
});

test('reissuing the plan does not reset the drill clock', () => {
  const drills = [{ id: 'd1', plan_id: 'p1', held_on: '2026-01-15' }];
  // Version 2 issued in August: the next drill still counts from January's drill under version 1.
  assert.equal(nextDrillDue(plan(2, '2026-08-01T00:00:00Z', 6), drills), '2026-07-15');
});
