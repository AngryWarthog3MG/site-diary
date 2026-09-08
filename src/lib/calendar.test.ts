import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isRestDay } from './calendar.ts';

test('Saturday and Sunday are rest days; Monday to Friday are not', () => {
  assert.equal(isRestDay('2026-09-05'), true); // Sat
  assert.equal(isRestDay('2026-09-06'), true); // Sun
  assert.equal(isRestDay('2026-09-07'), false); // Mon
  assert.equal(isRestDay('2026-09-11'), false); // Fri
});

test('the answer depends on the date alone, not on the process time zone', () => {
  const tz = process.env.TZ;
  try {
    for (const zone of ['Australia/Perth', 'UTC', 'America/Los_Angeles']) {
      process.env.TZ = zone;
      assert.equal(isRestDay('2026-09-06'), true, zone);
      assert.equal(isRestDay('2026-09-07'), false, zone);
    }
  } finally {
    if (tz === undefined) delete process.env.TZ;
    else process.env.TZ = tz;
  }
});
