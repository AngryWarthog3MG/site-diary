import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distinctPhotos, groupByDay, groupByMonth, monthLabel, zipEntries, zipFileName, type LibraryPhoto } from './library.ts';

const photo = (over: Partial<LibraryPhoto>): LibraryPhoto => ({
  date: '2026-10-22',
  path: 'p/e/a.jpg',
  context: 'Site photograph',
  caption: null,
  entryNo: 'KBL-2026-10-22',
  day: 'signed',
  source: 'diary',
  by: null,
  ...over,
});

test('a photograph on a daywork and on the day prints once per day, never twice', () => {
  const rows = [photo({ context: 'Dayworks', caption: 'Extra over' }), photo({ context: 'Site photograph' }), photo({ date: '2026-10-23' })];
  const out = distinctPhotos(rows);
  assert.equal(out.length, 2);
  assert.equal(out[0].context, 'Dayworks');
});

test('days run newest first, months newest first, counts add up', () => {
  const days = groupByDay([
    photo({ date: '2026-09-30', path: 'a' }),
    photo({ date: '2026-10-22', path: 'b' }),
    photo({ date: '2026-10-22', path: 'c' }),
    photo({ date: '2026-10-01', path: 'd', entryNo: null, day: 'none', source: 'crew', by: 'Evan Burke' }),
  ]);
  assert.deepEqual(days.map((d) => d.date), ['2026-10-22', '2026-10-01', '2026-09-30']);
  const months = groupByMonth(days);
  assert.deepEqual(months.map((m) => [m.month, m.count]), [['2026-10', 3], ['2026-09', 1]]);
  assert.equal(monthLabel('2026-10'), 'October 2026');
});

test('a crew photograph joining a signed day takes the day’s serial and standing', () => {
  const days = groupByDay([
    photo({ path: 'crew.jpg', entryNo: null, day: 'none', source: 'crew' }),
    photo({ path: 'day.jpg' }),
  ]);
  assert.equal(days[0].entryNo, 'KBL-2026-10-22');
  assert.equal(days[0].day, 'signed');
  // A draft day has no serial yet; it is still a day, not "no diary".
  assert.equal(groupByDay([photo({ entryNo: null, day: 'draft' })])[0].day, 'draft');
});

test('the download names each file by its day and number, dates oldest first, and keeps bad characters out', () => {
  const days = groupByDay([
    photo({ date: '2026-10-22', path: 'p/e/x.jpeg', context: 'Variation V-003', caption: 'Rock: "big" / hard?' }),
    photo({ date: '2026-10-22', path: 'p/e/y.png', entryNo: null, day: 'draft', source: 'diary' }),
    photo({ date: '2026-09-30', path: 'p/day/z.jpg', entryNo: null, day: 'none', source: 'crew', by: 'Evan' }),
  ]);
  const names = zipEntries('C010', days).map((e) => e.name);
  assert.deepEqual(names, [
    'C010 photographs/2026-09-30/2026-09-30 01 Site photograph (crew, not yet on the day).jpg',
    'C010 photographs/2026-10-22/2026-10-22 01 Variation V-003 - Rock big hard.jpeg',
    'C010 photographs/2026-10-22/2026-10-22 02 Site photograph (draft).png',
  ]);
  assert.equal(zipFileName('C010', '2026-10'), 'C010 photographs 2026-10.zip');
  assert.equal(zipFileName('C010', null), 'C010 photographs.zip');
});

test('a long caption is cut, not dropped', () => {
  const long = 'x'.repeat(200);
  const [e] = zipEntries('C010', groupByDay([photo({ caption: long })]));
  assert.ok(e.name.length < 200);
  assert.ok(e.name.includes('…'));
});
