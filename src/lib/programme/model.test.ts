import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, baselines, currentBaseline, currentLookahead, fileLabel, lookaheadEnd, lookaheads, mondayOf, nextLookaheadStart, periodLabel, type Programme } from './model.ts';

const row = (over: Partial<Programme>): Programme => ({
  id: over.id ?? Math.random().toString(36).slice(2), kind: 'baseline', title: 'x', revision: null, issued_on: null, period_start: null, period_end: null,
  notes: null, file_path: 'p/x.pdf', content_type: 'application/pdf', size_bytes: null, uploaded_by: null, voided_at: null, void_reason: null,
  created_at: '2026-09-01T00:00:00Z', ...over,
});

test('a fortnight is the start day and thirteen more; Mondays are found across a Sunday', () => {
  assert.equal(lookaheadEnd('2026-09-21'), '2026-10-04');
  assert.equal(addDays('2026-12-30', 5), '2027-01-04');
  assert.equal(mondayOf('2026-09-22'), '2026-09-21'); // Tuesday
  assert.equal(mondayOf('2026-09-21'), '2026-09-21'); // Monday
  assert.equal(mondayOf('2026-09-27'), '2026-09-21'); // Sunday belongs to the week before
});

test('the current baseline is the newest issued still live; voided ones fall out', () => {
  const rows = [
    row({ id: 'a', issued_on: '2026-06-01', revision: '0' }),
    row({ id: 'b', issued_on: '2026-08-15', revision: '1' }),
    row({ id: 'v', issued_on: '2026-09-01', revision: '2', voided_at: '2026-09-02T00:00:00Z', void_reason: 'wrong file' }),
    row({ id: 'n', issued_on: null, revision: 'undated', created_at: '2026-09-10T00:00:00Z' }),
  ];
  assert.equal(currentBaseline(rows)?.id, 'b');
  assert.deepEqual(baselines(rows).map((r) => r.id), ['b', 'a', 'n']);
  assert.equal(currentBaseline([]), null);
});

test('look-aheads list latest fortnight first; the one holding today is current; the next starts after the latest', () => {
  const rows = [
    row({ id: 'l1', kind: 'lookahead', period_start: '2026-09-07', period_end: '2026-09-20' }),
    row({ id: 'l2', kind: 'lookahead', period_start: '2026-09-21', period_end: '2026-10-04' }),
  ];
  assert.deepEqual(lookaheads(rows).map((r) => r.id), ['l2', 'l1']);
  assert.equal(currentLookahead(rows, '2026-09-22')?.id, 'l2');
  assert.equal(currentLookahead(rows, '2026-10-05'), null);
  assert.equal(nextLookaheadStart(rows, '2026-09-22'), '2026-10-05');
  // A lapsed job picks up from this week, not from months ago.
  assert.equal(nextLookaheadStart(rows, '2026-12-16'), '2026-12-14');
  assert.equal(nextLookaheadStart([], '2026-09-22'), '2026-09-21');
});

test('labels', () => {
  assert.equal(periodLabel('2026-09-21', '2026-10-04'), '21 Sep – 4 Oct 2026');
  assert.equal(periodLabel('2026-12-28', '2027-01-10'), '28 Dec 2026 – 10 Jan 2027');
  assert.equal(fileLabel('application/pdf', 1258291), 'PDF · 1.2 MB');
  assert.equal(fileLabel('application/octet-stream', 40960, 'x/y.mpp'), 'MS Project · 40 KB');
  assert.equal(fileLabel('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', null), 'Spreadsheet');
});
