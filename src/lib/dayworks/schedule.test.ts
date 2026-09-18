import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSchedule, readRange, scheduleLines, weekStart, type DayworkLine } from './schedule.ts';

const line = (date: string, works: string, hours: number | null, docket: string | null = null): DayworkLine =>
  ({ date, entryNo: `KBL-${date}`, entryId: null, dayworkId: `dw-${date}-${works}`, works, labour: null, plant: null, materials: null, hours, docket, docketAddedOn: null });

test('weeks start on Monday', () => {
  assert.equal(weekStart('2026-09-17'), '2026-09-14'); // Thursday
  assert.equal(weekStart('2026-09-20'), '2026-09-14'); // Sunday
  assert.equal(weekStart('2026-09-14'), '2026-09-14');
});

test('grouped by week in date order, with week and period totals', () => {
  const s = buildSchedule([
    line('2026-09-15', 'Relocate kerb', 6, 'DW-12'),
    line('2026-09-08', 'Clear spoil for client', 4.5),
    line('2026-09-09', 'Extra trench', 3.25, 'DW-9'),
  ], { from: null, to: null });
  assert.deepEqual(s.weeks.map((w) => [w.start, w.lines.length, w.hours]), [['2026-09-07', 2, 7.75], ['2026-09-14', 1, 6]]);
  assert.deepEqual(s.totals, { items: 3, days: 3, hours: 13.75, hoursNotRecorded: 0, docketed: 2, toChase: 1 });
});

test('a daywork with no hours is flagged, never counted as zero hours recorded', () => {
  const s = buildSchedule([line('2026-09-08', 'A', 2), line('2026-09-08', 'B', null)], { from: null, to: null });
  assert.equal(s.totals.hours, 2);
  assert.equal(s.totals.hoursNotRecorded, 1);
  assert.equal(s.weeks[0].hoursNotRecorded, 1);
  assert.equal(s.totals.days, 1);
});

test('the period filters inclusively', () => {
  const s = buildSchedule([line('2026-08-31', 'A', 1), line('2026-09-01', 'B', 2), line('2026-09-30', 'C', 3), line('2026-10-01', 'D', 4)], { from: '2026-09-01', to: '2026-09-30' });
  assert.deepEqual(s.weeks.flatMap((w) => w.lines.map((l) => l.works)), ['B', 'C']);
});

test('periods read from the address', () => {
  const today = '2026-09-17';
  assert.deepEqual(readRange({}, today), { key: 'all', from: null, to: null, label: 'Whole job' });
  assert.deepEqual(readRange({ range: 'week' }, today), { key: 'week', from: '2026-09-14', to: '2026-09-20', label: 'Week of 14/09/2026' });
  assert.deepEqual(readRange({ range: 'month' }, today), { key: 'month', from: '2026-09-01', to: '2026-09-30', label: 'September 2026' });
  assert.deepEqual(readRange({ range: 'last-month' }, '2026-01-05'), { key: 'last-month', from: '2025-12-01', to: '2025-12-31', label: 'December 2025' });
  assert.equal(readRange({ range: 'custom', from: '2026-09-20', to: '2026-09-01' }, today).from, '2026-09-01');
  assert.equal(readRange({ range: 'custom', from: 'nonsense' }, today).key, 'all');
});

test('the sign-off sheet numbers items in schedule order, week by week', () => {
  const s = buildSchedule([
    line('2026-09-15', 'Relocate kerb', 6),
    line('2026-09-08', 'Clear spoil', 4.5),
    line('2026-09-09', 'Extra trench', 3.25),
  ], { from: null, to: null });
  assert.deepEqual(scheduleLines(s).map((l) => l.works), ['Clear spoil', 'Extra trench', 'Relocate kerb']);
  // Item 1 on the sheet is the first line of the first week, whatever order they arrived in.
  assert.equal(scheduleLines(s).length, s.totals.items);
});
