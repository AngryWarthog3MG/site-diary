import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanName, needsName } from './name.ts';

test('a name is tidied', () => {
  assert.deepEqual(cleanName('  Matthew   Rodgers '), { ok: true, name: 'Matthew Rodgers' });
  assert.deepEqual(cleanName('AJ'), { ok: true, name: 'AJ' });
});

test('blank, an email address, or too long is refused', () => {
  assert.equal(cleanName('   ').ok, false);
  assert.equal(cleanName(null).ok, false);
  assert.equal(cleanName('tigereyegreen@hotmail.com').ok, false);
  assert.equal(cleanName('x'.repeat(81)).ok, false);
});

test('an account with no name, or an email for a name, is asked for one', () => {
  assert.equal(needsName({ full_name: null }), true);
  assert.equal(needsName(null), true);
  assert.equal(needsName({ full_name: 'sam@example.com' }), true);
  assert.equal(needsName({ full_name: 'Sam' }), false);
});
