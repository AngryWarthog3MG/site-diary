import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayState, monthTiles, summariseMonth, type CalendarRow } from './calendar-month.ts';

const TODAY = '2026-10-08';
const r = (over: Partial<CalendarRow>): CalendarRow => ({ id: 'a', entry_date: '2026-10-05', status: 'signed', correction: false, supersedes: null, ...over });

test('a day is what its record holds: signed, draft, ready, correction, hole, rest, future, before', () => {
  assert.equal(dayState([r({})], '2026-10-05', TODAY, '2026-09-01').state, 'signed');
  assert.equal(dayState([r({ status: 'draft' })], '2026-10-05', TODAY, '2026-09-01').state, 'draft');
  assert.equal(dayState([r({ status: 'draft', ready: true })], '2026-10-05', TODAY, '2026-09-01').state, 'ready');
  // A signed day with an unsigned correction reads as a correction, and opens the correction.
  const c = dayState([r({ id: 's' }), r({ id: 'c', status: 'draft', correction: true, supersedes: 's' })], '2026-10-05', TODAY, '2026-09-01');
  assert.deepEqual([c.state, c.entryId], ['correction', 'c']);
  // A signed correction replaces the original: the day is signed, and opens the current version.
  const v = dayState([r({ id: 's', entry_no: 'KBL-1' }), r({ id: 'c2', entry_no: 'KBL-1-2', supersedes: 's' })], '2026-10-05', TODAY, '2026-09-01');
  assert.deepEqual([v.state, v.entryId, v.entryNo], ['signed', 'c2', 'KBL-1-2']);
  assert.equal(dayState([], '2026-10-06', TODAY, '2026-09-01').state, 'gap');
  assert.equal(dayState([], '2026-10-04', TODAY, '2026-09-01').state, 'rest');
  assert.equal(dayState([], '2026-10-09', TODAY, '2026-09-01').state, 'future');
  assert.equal(dayState([], '2026-08-20', TODAY, '2026-09-01').state, 'before');
  assert.equal(dayState([], TODAY, TODAY, '2026-09-01').state, 'gap');
});

test('the month is whole weeks of tiles, and its figures come from them', () => {
  const rows = [r({ id: '1', entry_date: '2026-10-01' }), r({ id: '2', entry_date: '2026-10-02' }), r({ id: '3', entry_date: '2026-10-05', status: 'draft' }), r({ id: '4', entry_date: '2026-10-07', status: 'draft', ready: true })];
  const weeks = monthTiles(rows, '2026-10', TODAY);
  assert.equal(weeks[0][0].date, '2026-09-28');
  assert.equal(weeks[0][0].inMonth, false);
  assert.equal(weeks.at(-1)![6].date, '2026-11-01');
  assert.ok(weeks.flat().some((t) => t.today && t.date === TODAY));
  const oct = Object.fromEntries(weeks.flat().filter((t) => t.inMonth).map((t) => [t.date.slice(8), t.state]));
  assert.equal(oct['01'], 'signed'); assert.equal(oct['05'], 'draft'); assert.equal(oct['07'], 'ready');
  assert.equal(oct['06'], 'gap'); assert.equal(oct['03'], 'rest'); assert.equal(oct['08'], 'gap'); assert.equal(oct['09'], 'future');
  assert.deepEqual(summariseMonth(weeks), { signed: 2, drafts: 2, ready: 1, corrections: 0, gaps: 2 });
});
