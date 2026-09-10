import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isNetworkError, isPermissionError, isAlreadyDone, isFrozen, backoffMs } from './offline.ts';

test('a dropped connection is a network error; a refusal is not', () => {
  assert.equal(isNetworkError(new TypeError('Failed to fetch')), true);
  assert.equal(isNetworkError(new Error('Load failed')), true);
  assert.equal(isNetworkError({ code: '42501', message: 'new row violates row-level security policy' }), false);
  // supabase-js reports a dead network as a plain object, not a TypeError
  assert.equal(isNetworkError({ message: 'TypeError: Failed to fetch', name: 'StorageUnknownError' }), true);
  assert.equal(isNetworkError({ message: 'Failed to fetch', details: 'TypeError: Failed to fetch', code: '' }), true);
});

test('rights, duplicates and frozen records are told apart', () => {
  assert.equal(isPermissionError({ code: '42501', message: 'x' }), true);
  assert.equal(isPermissionError(new Error('new row violates row-level security policy for table')), true);
  assert.equal(isAlreadyDone({ code: '23505', message: 'duplicate key value' }), true);
  assert.equal(isAlreadyDone(new Error('The resource already exists')), true);
  assert.equal(isFrozen(new Error('This prestart is finished and cannot be modified.')), true);
  assert.equal(isFrozen(new Error('This plant prestart is signed and cannot be modified.')), true);
  assert.equal(isFrozen(new Error('Failed to fetch')), false);
});

test('backoff grows and caps at half an hour', () => {
  assert.equal(backoffMs(1), 30_000);
  assert.equal(backoffMs(2), 60_000);
  assert.equal(backoffMs(20), 30 * 60 * 1000);
});
