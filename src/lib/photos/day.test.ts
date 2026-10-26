import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayPhotoPath, freshDayPhotos, localDate } from './day.ts';

test('a day photo lives in the job and day folder, never an entry folder', () => {
  assert.equal(dayPhotoPath('p1', '2026-10-26', 'abc', 'jpg'), 'p1/day/2026-10-26/abc.jpg');
  assert.equal(dayPhotoPath('p1', '2026-10-26', 'abc', '.png'), 'p1/day/2026-10-26/abc.png');
  assert.equal(dayPhotoPath('p1', '2026-10-26', 'abc', ''), 'p1/day/2026-10-26/abc.jpg');
});

test('the local date is the device\'s own calendar day', () => {
  assert.equal(localDate(new Date(2026, 9, 26, 23, 30)), '2026-10-26');
  assert.equal(localDate(new Date(2026, 0, 5, 0, 10)), '2026-01-05');
});

test('fresh photos are the ones not yet offered, once each, as progress photos; a removed one stays off', () => {
  const rows = [
    { url: 'p/day/d/a.jpg', caption: ' Trench open ', taken_at: '2026-10-26T01:00:00Z' },
    { url: 'p/day/d/a.jpg', caption: null, taken_at: null },
    { url: 'p/day/d/b.jpg', caption: null, taken_at: null },
    { url: 'p/day/d/c.jpg', caption: 'Removed by the supervisor', taken_at: null },
  ];
  const fresh = freshDayPhotos(rows, new Set(['p/day/d/c.jpg']));
  assert.deepEqual(fresh, [
    { url: 'p/day/d/a.jpg', caption: 'Trench open', category: 'progress', taken_at: '2026-10-26T01:00:00Z', lat: null, lng: null },
    { url: 'p/day/d/b.jpg', caption: null, category: 'progress', taken_at: null, lat: null, lng: null },
  ]);
  assert.deepEqual(freshDayPhotos(rows, new Set(rows.map((r) => r.url))), []);
});
