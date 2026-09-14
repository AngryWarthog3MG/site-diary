import test from 'node:test';
import assert from 'node:assert/strict';
import { controlsFor, closeoutFor, readControls, allAnswered, permitRef, expired, live, PERMIT_KINDS } from './model.ts';

test('every kind has controls before and at close-out, keyed uniquely', () => {
  for (const k of PERMIT_KINDS) {
    const before = controlsFor(k); const after = closeoutFor(k);
    assert.ok(before.length >= 5, k); assert.ok(after.length >= 3, k);
    assert.equal(new Set(before.map((c) => c.key)).size, before.length, k);
  }
});

test('controls read back tolerant, and all-answered means every one', () => {
  const c = readControls([{ key: 'a', label: 'A', result: 'yes' }, { key: 'b', label: 'B', result: 'no' }, 'junk']);
  assert.equal(c.length, 3);
  assert.equal(c[1].result, null);
  assert.equal(allAnswered(c), false);
  assert.equal(allAnswered([{ key: 'a', label: 'A', result: 'yes' }, { key: 'b', label: 'B', result: 'na' }]), true);
  assert.equal(allAnswered([]), false);
});

test('numbering and the window', () => {
  assert.equal(permitRef(3), 'PTW-003');
  const p = { status: 'issued' as const, valid_from: '2026-09-14T00:00:00Z', valid_to: '2026-09-14T08:00:00Z' };
  assert.equal(live(p, '2026-09-14T03:00:00Z'), true);
  assert.equal(expired(p, '2026-09-14T09:00:00Z'), true);
  assert.equal(expired({ ...p, status: 'closed' }, '2026-09-14T09:00:00Z'), false);
});
