import test from 'node:test';
import assert from 'node:assert/strict';
import { planVolumes, volumePath } from './volumes.ts';

const MB = 1024 * 1024;

test('a light month is one part', () => {
  assert.deepEqual(planVolumes([3 * MB, 0.1 * MB, 7 * MB]), [[0, 1, 2]]);
});

test('a heavy month splits in date order, nothing left out, each part within the budget', () => {
  // September on Curtin so far, in MB.
  const sizes = [7, 7, 7, 2.8, 0.1, 0.1, 14.6, 14.7, 7.5, 0.1, 0.1, 0.1, 9.3, 7.6, 9.8, 25.8, 19.3].map((n) => n * MB);
  const parts = planVolumes(sizes);
  assert.deepEqual(parts.flat(), sizes.map((_, i) => i));
  for (const part of parts) assert.ok(part.reduce((sum, i) => sum + sizes[i], 0) <= 40 * MB);
  assert.ok(parts.length >= 4);
});

test('a docket over the budget on its own gets a part to itself', () => {
  assert.deepEqual(planVolumes([5 * MB, 45 * MB, 5 * MB]), [[0], [1], [2]]);
});

test('one part keeps the old name; several are numbered', () => {
  assert.equal(volumePath('p', '2026-09', 1, 1), 'p/monthly/2026-09.pdf');
  assert.equal(volumePath('p', '2026-09', 2, 4), 'p/monthly/2026-09-part-2-of-4.pdf');
});
