import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distinctPhotos, groupByDay, groupByMonth, monthLabel, monthRange, zipEntries, zipFileName, kindOf, kindsOf, photoMatches, filterMonths, type LibraryPhoto } from './library.ts';

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

test('a month’s range ends on its real last day — September has no 31st, which the database read as no month at all', () => {
  assert.deepEqual(monthRange('2026-09'), { from: '2026-09-01', to: '2026-09-30' });
  assert.deepEqual(monthRange('2026-10'), { from: '2026-10-01', to: '2026-10-31' });
  assert.deepEqual(monthRange('2028-02'), { from: '2028-02-01', to: '2028-02-29' });
  assert.throws(() => monthRange('2026-9'));
});

test('the finder: a kind per context, every word must match, and empty days fall away (README R183)', () => {
  const a = photo({ path: 'a', context: 'Variation V-003', caption: 'Extra kerb at the north gate' });
  const b = photo({ path: 'b', context: 'Concrete docket — Pad 4', date: '2026-10-21' });
  const c = photo({ path: 'c', context: 'Progress photograph', source: 'crew', by: 'Evan', day: 'none', entryNo: null, date: '2026-09-30' });
  assert.deepEqual([kindOf(a), kindOf(b), kindOf(c)], ['Variation', 'Concrete docket', 'Progress photograph']);
  assert.deepEqual(kindsOf([a, b, c, a]), [{ kind: 'Variation', count: 2 }, { kind: 'Concrete docket', count: 1 }, { kind: 'Progress photograph', count: 1 }]);
  assert.equal(photoMatches(a, 'kerb gate'), true);
  assert.equal(photoMatches(a, 'kerb south'), false, 'every word');
  assert.equal(photoMatches(a, 'v-003'), true, 'the variation number');
  assert.equal(photoMatches(b, '21/10/2026'), true, 'the day as printed');
  assert.equal(photoMatches(b, '21 oct'), true, 'the day as said');
  assert.equal(photoMatches(c, 'evan'), true, 'who added it');
  assert.equal(photoMatches(a, '', 'Variation'), true);
  assert.equal(photoMatches(a, '', 'Dayworks'), false);
  const months = groupByMonth(groupByDay([a, b, c]));
  assert.deepEqual(filterMonths(months, 'evan').map((m) => [m.month, m.count]), [['2026-09', 1]]);
  assert.deepEqual(filterMonths(months, '', 'Concrete docket').flatMap((m) => m.days.map((d) => d.date)), ['2026-10-21']);
  assert.equal(filterMonths(months, '').length, 2, 'no search, nothing dropped');
  assert.equal(filterMonths(months, 'nothing like this').length, 0);
});

test('a record’s photograph is its own kind, never a draft of the diary, and names its record in the download (README R184)', () => {
  const inc = photo({ path: 'i.jpg', context: 'INC-003 · Near miss', source: 'incident', by: 'Evan', day: 'draft', entryNo: null, caption: 'North gate' });
  const qa = photo({ path: 'q.jpg', context: '6425-KBS-ITR-002 · Building 2 & 3', source: 'qa', day: 'none', entryNo: null, caption: 'Item 12' });
  assert.deepEqual([kindOf(inc), kindOf(qa)], ['Hazard or incident', 'Inspection and test record']);
  assert.equal(photoMatches(inc, 'inc-003 evan'), true);
  assert.equal(photoMatches(qa, 'building item 12'), true);
  const names = zipEntries('C010', groupByDay([inc, qa, photo({ path: 'd.jpg', day: 'draft', entryNo: null })])).map((e) => e.name.split('/').pop());
  assert.ok(names.some((n) => n?.includes('INC-003 · Near miss - North gate.jpg') && !n.includes('(draft)')), names.join(' | '));
  assert.ok(names.some((n) => n?.includes('6425-KBS-ITR-002 · Building 2 & 3 - Item 12.jpg')), names.join(' | '));
  assert.ok(names.some((n) => n?.includes('Site photograph (draft)')), 'the diary’s own draft still says so');
});
