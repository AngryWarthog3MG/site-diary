import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLANT_CHECKS, PLANT_KINDS, readChecks, allAnswered } from './checklist.ts';

test('every kind has a real checklist with unique keys and the common tail', () => {
  for (const kind of PLANT_KINDS) {
    const items = PLANT_CHECKS[kind];
    assert.ok(items.length >= 6, `${kind} has only ${items.length} checks`);
    assert.equal(new Set(items.map((i) => i.key)).size, items.length, `${kind} has a duplicate key`);
    assert.ok(items.some((i) => i.key === 'fire_ext'), `${kind} has no extinguisher check`);
    assert.ok(items.some((i) => i.key === 'defects_closed'), `${kind} does not ask about previous defects`);
  }
});

test('stored checks are read defensively', () => {
  assert.deepEqual(readChecks(null), []);
  assert.deepEqual(readChecks([{ key: 'fuel', label: 'Fuel', result: 'ok' }, { key: 'x' }, 'junk', { key: 'y', label: 'Y', result: 'maybe' }]),
    [{ key: 'fuel', label: 'Fuel', result: 'ok' }]);
});

test('signing waits until every check is answered', () => {
  const partial = { walkaround: 'ok' as const };
  assert.equal(allAnswered('excavator', partial), false);
  const full = Object.fromEntries(PLANT_CHECKS.excavator.map((i) => [i.key, 'ok' as const]));
  assert.equal(allAnswered('excavator', full), true);
});
