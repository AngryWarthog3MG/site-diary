import test from 'node:test';
import assert from 'node:assert/strict';
import { localDate } from './queue.ts';

test('a local-midnight date formats as that local day, not the UTC day before', () => {
  // The bug this pins: the week strip built its dates with
  // `new Date(`${today}T00:00:00`)` — local midnight — and then formatted
  // them with toISOString(), which is UTC. East of Greenwich that is the
  // previous day, so every square in the strip was labelled one day early:
  // Saturday the 5th showed as Saturday the 4th.
  const localMidnight = new Date('2026-09-05T00:00:00');
  assert.equal(localDate(localMidnight), '2026-09-05');

  // And walking a week forward keeps each day's own date.
  const cursor = new Date('2026-09-05T00:00:00');
  cursor.setDate(cursor.getDate() - 6);
  const week: string[] = [];
  for (let i = 0; i < 7; i += 1) {
    week.push(localDate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  assert.deepEqual(week, [
    '2026-08-30', '2026-08-31', '2026-09-01',
    '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05',
  ]);
});
