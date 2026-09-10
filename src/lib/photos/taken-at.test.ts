import { test } from 'node:test';
import assert from 'node:assert/strict';
import { photoTakenAt } from './taken-at.ts';

const NOW = Date.UTC(2026, 8, 10, 8, 0, 0);

test('a sane file timestamp is kept', () => {
  assert.equal(photoTakenAt({ lastModified: Date.UTC(2026, 8, 9, 22, 46, 0) }, NOW), '2026-09-09T22:46:00.000Z');
});

test('a bad or missing timestamp becomes now, never a throw', () => {
  for (const bad of [0, -5, NaN, Infinity, 'yesterday', undefined, null, 8.64e15 * 10]) {
    assert.equal(photoTakenAt({ lastModified: bad as unknown }, NOW), new Date(NOW).toISOString(), String(bad));
  }
});
