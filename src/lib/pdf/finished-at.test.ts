import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finishedAtAwst } from './finished-at.ts';

test('one time when the clocks agree, both when the record arrived later', () => {
  assert.equal(finishedAtAwst('2026-09-10T01:02:00Z', '2026-09-10T01:02:30Z'), '2026-09-10 09:02 AWST');
  assert.equal(finishedAtAwst('2026-09-10T01:02:00Z', null), '2026-09-10 09:02 AWST');
  assert.equal(finishedAtAwst('2026-09-10T01:02:00Z', '2026-09-09T22:48:00Z'), '2026-09-10 06:48 AWST on the phone; received 2026-09-10 09:02 AWST');
});
