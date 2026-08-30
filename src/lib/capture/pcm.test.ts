import { test } from 'node:test';
import assert from 'node:assert/strict';
import { floatToInt16 } from './pcm.ts';

test('silence maps to zero', () => {
  const out = floatToInt16(new Float32Array([0, 0, 0]));
  assert.deepEqual([...out], [0, 0, 0]);
});

test('full scale lands on the rails, not over them', () => {
  const out = floatToInt16(new Float32Array([1, -1]));
  assert.equal(out[0], 32767);
  assert.equal(out[1], -32768);
});

test('clamps out-of-range samples instead of wrapping', () => {
  // Web Audio does not guarantee [-1, 1]; wrapping would turn a loud moment
  // into a burst of noise, which is exactly when the numbers get said.
  const out = floatToInt16(new Float32Array([1.8, -2.4, 99, -99]));
  assert.deepEqual([...out], [32767, -32768, 32767, -32768]);
});

test('mid-scale values are proportional', () => {
  const out = floatToInt16(new Float32Array([0.5, -0.5]));
  assert.ok(Math.abs(out[0] - 16383) <= 1, `got ${out[0]}`);
  assert.ok(Math.abs(out[1] + 16384) <= 1, `got ${out[1]}`);
});

test('length is preserved and the result is 16-bit', () => {
  const out = floatToInt16(new Float32Array(1024));
  assert.equal(out.length, 1024);
  assert.equal(out.BYTES_PER_ELEMENT, 2);
  assert.equal(out.buffer.byteLength, 2048);
});

test('NaN does not escape as a wild value', () => {
  const out = floatToInt16(new Float32Array([Number.NaN]));
  assert.ok(Number.isFinite(out[0]), 'NaN produced a non-finite sample');
});
