import { test } from 'node:test';
import assert from 'node:assert/strict';
import { headContractorName, noticeState, currentDocs, swmsReviewStatus, type HcDoc, type SwmsReview } from './model.ts';

test('the head contractor is named when the job has a name', () => {
  assert.equal(headContractorName(' Lendlease '), 'Lendlease');
  assert.equal(headContractorName(null), 'the head contractor');
});

test('telling the head contractor: a deadline only where their rules set one', () => {
  const occurred = '2026-09-17T01:00:00.000Z';
  const late = noticeState(occurred, [], 2, '2026-09-17T04:00:00.000Z');
  assert.equal(late.dueAt, '2026-09-17T03:00:00.000Z');
  assert.equal(late.overdue, true);
  assert.equal(noticeState(occurred, [], null, '2026-09-30T00:00:00.000Z').overdue, false);
  const told = noticeState(occurred, [
    { id: 'b', notified_at: '2026-09-17T02:30:00.000Z', method: 'phone', told_by_name: 'x', recipient_name: null, reference: null, detail: null },
    { id: 'a', notified_at: '2026-09-17T01:45:00.000Z', method: 'their_system', told_by_name: 'x', recipient_name: null, reference: 'LL-1', detail: null },
  ], 2, '2026-09-17T04:00:00.000Z');
  assert.deepEqual([told.toldAt, told.overdue, told.minutesToTell], ['2026-09-17T01:45:00.000Z', false, 45]);
});

const doc = (id: string, kind: HcDoc['kind'], received_on: string, superseded_by: string | null = null): HcDoc =>
  ({ id, kind, title: id, revision: null, received_on, file_path: null, superseded_by, notes: null });

test('the plan in force is the latest copy nobody superseded', () => {
  const cur = currentDocs([doc('b', 'whs_management_plan', '2026-08-01', 'c'), doc('c', 'whs_management_plan', '2026-09-01'), doc('r', 'site_rules', '2026-08-01')]);
  assert.equal(cur.get('whs_management_plan')?.id, 'c');
  assert.equal(cur.get('site_rules')?.id, 'r');
  assert.equal(cur.get('emergency_plan'), undefined);
});

const rev = (kind: SwmsReview['kind'], day: string, at: string): SwmsReview => ({ id: kind + at, kind, happened_on: day, person_name: null, reference: null, comments: null, created_at: at });

test('a SWMS stands where its latest review step left it', () => {
  assert.equal(swmsReviewStatus([]).status, 'not_submitted');
  assert.equal(swmsReviewStatus([rev('submitted', '2026-09-15', '1')]).status, 'with_them');
  assert.equal(swmsReviewStatus([rev('submitted', '2026-09-15', '1'), rev('returned', '2026-09-16', '2')]).status, 'returned');
  assert.equal(swmsReviewStatus([rev('submitted', '2026-09-15', '1'), rev('returned', '2026-09-16', '2'), rev('submitted', '2026-09-17', '3'), rev('accepted', '2026-09-17', '4')]).status, 'accepted');
});

test('a step still on the phone sorts after the saved steps of the same day', () => {
  const saved = { ...rev('submitted', '2026-09-17', '2026-09-17T01:00:00Z') };
  const queued = { ...rev('returned', '2026-09-17', '2026-09-17T00:30:00Z'), queued: true };
  assert.equal(swmsReviewStatus([saved, queued]).status, 'returned');
});
