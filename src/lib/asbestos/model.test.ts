import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerInForce, planReviewDue, notBriefed, notRequiredProblem, removalProblems, isLicensedRemoval } from './model.ts';

const reg = (id: string, date: string, o: { superseded_by?: string | null; plan_date?: string | null; asbestos_present?: boolean } = {}) =>
  ({ id, register_date: date, superseded_by: o.superseded_by ?? null, plan_date: o.plan_date ?? null, asbestos_present: o.asbestos_present ?? false });

test('the register in force is the one nothing has superseded', () => {
  assert.equal(registerInForce([reg('a', '2026-01-01', { superseded_by: 'b' }), reg('b', '2026-06-01')])?.id, 'b');
  assert.equal(registerInForce([]), null);
});

test('the management plan is reviewed five years from its date', () => {
  assert.equal(planReviewDue(reg('a', '2026-01-01', { plan_date: '2024-02-29', asbestos_present: true })), '2029-02-28');
  assert.equal(planReviewDue(reg('a', '2026-01-01')), null);
});

test('the crew not yet briefed, matched loosely and listed once', () => {
  assert.deepEqual(notBriefed(['Evan Burke', 'Marcus Hayden', 'AJ', 'aj '], ['evan  burke']), ['Marcus Hayden', 'AJ']);
});

test('no register is required only when all three limbs hold', () => {
  assert.equal(notRequiredProblem(true, true, true), null);
  assert.ok(notRequiredProblem(true, true, false));
  assert.ok(notRequiredProblem(false, true, true));
});

test('removal: friable needs Class A, and five days notice unless an emergency', () => {
  assert.deepEqual(removalProblems({ friable: false, area_m2: 30, licence_class: 'B', emergency: false, notified_worksafe_on: '2026-09-01', work_start_on: '2026-09-06' }), []);
  assert.equal(removalProblems({ friable: false, area_m2: 30, licence_class: 'B', emergency: false, notified_worksafe_on: '2026-09-02', work_start_on: '2026-09-06' }).length, 1);
  assert.equal(removalProblems({ friable: true, area_m2: 2, licence_class: 'B', emergency: true, notified_worksafe_on: '2026-09-06', work_start_on: '2026-09-06' }).length, 1);
  assert.deepEqual(removalProblems({ friable: true, area_m2: 2, licence_class: 'A', emergency: true, notified_worksafe_on: '2026-09-06', work_start_on: '2026-09-06' }), []);
});

test('licensed removal is any friable, or more than 10 m² of non-friable', () => {
  assert.equal(isLicensedRemoval(true, 1), true);
  assert.equal(isLicensedRemoval(false, 10), false);
  assert.equal(isLicensedRemoval(false, 10.5), true);
  assert.equal(isLicensedRemoval(false, null), false);
});
