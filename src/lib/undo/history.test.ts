import { test } from 'node:test';
import assert from 'node:assert/strict';
import { begin, record, undo, redo, canUndo, canRedo, depth } from './history.ts';

test('nothing to undo at the start', () => {
  const h = begin('a');
  assert.equal(canUndo(h), false);
  assert.equal(canRedo(h), false);
  assert.equal(undo(h).present, 'a');
  assert.equal(redo(h).present, 'a');
});

test('undo walks back and redo walks forward', () => {
  let h = record(record(begin('a'), 'b'), 'c');
  assert.deepEqual(depth(h), { back: 2, forward: 0 });
  h = undo(h);
  assert.equal(h.present, 'b');
  h = undo(h);
  assert.equal(h.present, 'a');
  assert.equal(canUndo(h), false);
  h = redo(redo(h));
  assert.equal(h.present, 'c');
  assert.equal(canRedo(h), false);
});

test('a new change after undoing drops what was undone', () => {
  let h = record(record(begin('a'), 'b'), 'c');
  h = undo(h);
  h = record(h, 'd');
  assert.equal(canRedo(h), false);
  // The step you were on when you changed course is kept, so undo returns to it.
  assert.deepEqual([h.past, h.present], [['a', 'b'], 'd']);
  assert.equal(undo(h).present, 'b');
});

test('recording the same state again is not a step', () => {
  const same = { a: 1 };
  const h = record(begin(same), same);
  assert.equal(canUndo(h), false);
});

test('the history stops growing', () => {
  let h = begin(0);
  for (let i = 1; i <= 60; i += 1) h = record(h, i, 50);
  assert.equal(h.past.length, 50);
  assert.equal(h.past[0], 10);
});
