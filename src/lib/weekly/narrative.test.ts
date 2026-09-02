import test from 'node:test';
import assert from 'node:assert/strict';
import { allowedNumbers, unaccountedNumbers } from './narrative.ts';

test('numbers in the data are allowed in any common formatting', () => {
  const allowed = allowedNumbers({ hours: 9, rain: 4.5, ref: 'KBL-2026-08-28', time: '07:00' });
  assert.deepEqual(unaccountedNumbers('Matty did 9.00 hours; 4.5mm fell.', allowed), []);
  assert.deepEqual(unaccountedNumbers('Started at 07:00 on KBL-2026-08-28.', allowed), []);
  // "08" in the date also covers the figure 8 in prose.
  assert.deepEqual(unaccountedNumbers('Signed on the 28th of month 8.', allowed), []);
});

test('a figure the data cannot account for is caught', () => {
  const allowed = allowedNumbers({ hours: 9, delays: [{ duration_mins: 120 }] });
  assert.deepEqual(unaccountedNumbers('Roughly 14 hours were lost.', allowed), ['14']);
  assert.deepEqual(unaccountedNumbers('120 minutes lost over 9 hours.', allowed), []);
});

test('an invented decimal is caught even when its integer part exists', () => {
  const allowed = allowedNumbers({ volume: 12 });
  assert.deepEqual(unaccountedNumbers('Poured 12.5 cubes.', allowed), ['12.5']);
});

test('digit-grouping commas fold before the scan — $4,500 is 4500', () => {
  const allowed = allowedNumbers({ estimated_cost: 4500 });
  assert.deepEqual(unaccountedNumbers('Directed work valued at $4,500.', allowed), []);
  assert.deepEqual(unaccountedNumbers('Roughly $4,600 of work.', allowed), ['4600']);
});
