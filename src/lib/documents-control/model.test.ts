import test from 'node:test';
import assert from 'node:assert/strict';
import { coverage } from './model.ts';

test('coverage tells who has read the current version, by name however spaced', () => {
  const c = coverage(['Danny Rowe', 'Sam Whitely', 'Kel Brady'], ['danny  rowe', 'KEL BRADY']);
  assert.deepEqual(c.read, ['Danny Rowe', 'Kel Brady']);
  assert.deepEqual(c.unread, ['Sam Whitely']);
});
