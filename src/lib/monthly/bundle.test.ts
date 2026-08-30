import test from 'node:test';
import assert from 'node:assert/strict';
import { monthRange, MonthlyLoadError } from './bundle.ts';

test('monthRange covers the calendar month, leap years included', () => {
  assert.deepEqual(monthRange('2026-08'), { start: '2026-08-01', end: '2026-08-31' });
  assert.deepEqual(monthRange('2026-02'), { start: '2026-02-01', end: '2026-02-28' });
  assert.deepEqual(monthRange('2028-02'), { start: '2028-02-01', end: '2028-02-29' });
  assert.deepEqual(monthRange('2026-04'), { start: '2026-04-01', end: '2026-04-30' });
});

test('monthRange rejects anything that is not YYYY-MM', () => {
  for (const bad of ['2026-13', '2026-0', '2026-8', 'August', '2026-08-01']) {
    assert.throws(() => monthRange(bad), MonthlyLoadError);
  }
});
