import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bannedUntilIsFuture, isClosed } from './account.ts';

test('closed means banned into the future; a past or missing ban is open', () => {
  const now = new Date('2026-09-28T10:00:00Z');
  assert.equal(bannedUntilIsFuture(null, now), false);
  assert.equal(bannedUntilIsFuture('2026-09-28T09:59:59Z', now), false);
  assert.equal(bannedUntilIsFuture('2126-09-28T10:00:00Z', now), true);
  assert.equal(bannedUntilIsFuture('not a date', now), false);
  assert.equal(isClosed({ banned_until: '2126-01-01T00:00:00Z' }), true);
  assert.equal(isClosed({}), false);
});
