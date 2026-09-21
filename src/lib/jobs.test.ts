import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onJob, preferJob, readJobCookie, switchTarget } from './jobs.ts';

const m = (id: string, active = true) => ({ project_id: id, project: { active }, role: 'supervisor' as const });
const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'bbbbbbbb-0000-4000-8000-000000000002';
const C = 'cccccccc-0000-4000-8000-000000000003';

test('the job you chose comes first, and the others keep their order', () => {
  assert.deepEqual(preferJob([m(A), m(B), m(C)], B).map((x) => x.project_id), [B, A, C]);
  assert.deepEqual(preferJob([m(A), m(B), m(C)], C).map((x) => x.project_id), [C, A, B]);
});

test('a job the account is not on, or one asleep, changes nothing', () => {
  const list = [m(A), m(B, false), m(C)];
  assert.deepEqual(preferJob(list, 'dddddddd-0000-4000-8000-000000000004').map((x) => x.project_id), [A, B, C]);
  assert.deepEqual(preferJob(list, B).map((x) => x.project_id), [A, B, C]);
  assert.deepEqual(preferJob(list, null).map((x) => x.project_id), [A, B, C]);
  // Never the caller's array.
  const same = [m(A), m(B)];
  assert.notEqual(preferJob(same, B), same);
  assert.deepEqual(same.map((x) => x.project_id), [A, B]);
});

test('only a uuid is read off the cookie; junk is ignored', () => {
  assert.equal(readJobCookie(A), A);
  assert.equal(readJobCookie('curtin'), null);
  assert.equal(readJobCookie(''), null);
  assert.equal(readJobCookie(undefined), null);
  assert.equal(readJobCookie(`${A}; path=/`), null);
});

test('switching jobs lands on the section, never on another job’s detail page', () => {
  assert.equal(switchTarget('/entries/abc/review'), '/entries');
  assert.equal(switchTarget('/quality/lot/xyz'), '/quality');
  assert.equal(switchTarget('/quality/equipment'), '/quality/equipment');
  assert.equal(switchTarget('/reports/weekly'), '/reports/weekly');
  assert.equal(switchTarget('/settings/members/cards'), '/settings/members');
  assert.equal(switchTarget('/'), '/');
  assert.equal(switchTarget('/somewhere/odd'), '/');
  assert.equal(switchTarget('/entries/'), '/entries');
});

test('a screen address carries the job, except All jobs', () => {
  assert.equal(onJob('/entries', A), `/entries?project=${A}`);
  assert.equal(onJob('/portfolio', A), '/portfolio');
  assert.equal(onJob('/entries', null), '/entries');
});
