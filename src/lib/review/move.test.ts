import test from 'node:test';
import assert from 'node:assert/strict';
import { carriedOver, dayworkAsVariation, moveDayworkToVariations } from './move.ts';
import type { ReviewDaywork, ReviewPayload } from './schema.ts';

const daywork = (over: Partial<ReviewDaywork> = {}): ReviewDaywork => ({
  description: 'Marcus, Hamish on vac trailer widening trench',
  labour: null,
  plant: null,
  materials: null,
  hours: 10,
  docket_ref: null,
  photo_urls: [],
  source_quote: null,
  confidence: null,
  ...over,
});

const payload = (over: Partial<ReviewPayload> = {}): ReviewPayload =>
  ({ dayworks: [], variations: [], ...over }) as ReviewPayload;

test('what a variation has nowhere to put is kept, in the words that were typed', () => {
  assert.equal(carriedOver(daywork()), null);
  assert.equal(carriedOver(daywork({ plant: 'Vac Trailer, Vac Truck' })), 'plant: Vac Trailer, Vac Truck');
  assert.equal(
    carriedOver(daywork({ labour: '2x Marcus Hayden , Evan Burke', plant: 'Vac Trailer', materials: 'Con saw blade', docket_ref: 'DW-114' })),
    'labour: 2x Marcus Hayden , Evan Burke; plant: Vac Trailer; materials: Con saw blade; docket: DW-114',
  );
  // Blank is not something to carry.
  assert.equal(carriedOver(daywork({ plant: '   ', materials: '' })), null);
});

test('the daywork becomes a variation of the number picked, hours and photos intact', () => {
  const v = dayworkAsVariation(daywork({ plant: 'Vac Trailer, Vac Truck', photo_urls: ['a.jpg', 'b.jpg'] }), 1);
  assert.equal(v.description, 'Marcus, Hamish on vac trailer widening trench (plant: Vac Trailer, Vac Truck)');
  assert.equal(v.register_seq, 1);
  assert.equal(v.hours, 10);
  assert.deepEqual(v.photo_urls, ['a.jpg', 'b.jpg']);
  // Never guessed from free text — the names are tapped in on the row.
  assert.deepEqual(v.crew, []);
  assert.equal(v.vr_ref, null);
});

test('hours unstated stay unstated — the gap asks, nothing is invented', () => {
  assert.equal(dayworkAsVariation(daywork({ hours: null }), 1).hours, null);
});

test('a number not picked yet still moves, and the day cannot be signed until it is', () => {
  assert.equal(dayworkAsVariation(daywork(), null).register_seq, null);
});

test('the row leaves dayworks and joins variations, and the others keep their order', () => {
  const before = payload({
    dayworks: [daywork({ description: 'Fencing' }), daywork({ description: 'Vac trailer widening' }), daywork({ description: 'Drip lines' })],
    variations: [{ description: 'Already there' }] as ReviewPayload['variations'],
  });
  const after = moveDayworkToVariations(before, 1, 7);
  assert.deepEqual(after.dayworks.map((d) => d.description), ['Fencing', 'Drip lines']);
  assert.deepEqual(after.variations.map((v) => v.description), ['Already there', 'Vac trailer widening']);
  assert.equal(after.variations[1].register_seq, 7);
  // The day it was moved from is untouched.
  assert.equal(before.dayworks.length, 3);
});

test('a row that is not there moves nothing, so a double tap cannot take the next one', () => {
  const before = payload({ dayworks: [daywork()] });
  assert.equal(moveDayworkToVariations(before, 3, 1), before);
  assert.equal(moveDayworkToVariations(moveDayworkToVariations(before, 0, 1), 0, 1).variations.length, 1);
});
