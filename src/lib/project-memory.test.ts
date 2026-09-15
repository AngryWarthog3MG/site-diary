import test from 'node:test';
import assert from 'node:assert/strict';
import { homeHref } from './project-memory.ts';

test('home carries the job from the URL first, the remembered one second, and is plain Home otherwise', () => {
  assert.equal(homeHref('b', 'a'), '/?project=b');
  assert.equal(homeHref(null, 'a'), '/?project=a');
  assert.equal(homeHref(null, null), '/');
});
