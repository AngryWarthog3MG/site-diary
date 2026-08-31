import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ReviewPayload,
  reviewBlockingGaps,
  reviewQualityWarnings,
  GAP_PROMPTS,
  WARNING_PROMPTS,
} from './schema.ts';

/**
 * The blocking gaps are implemented twice on purpose — once here, so the amber
 * prompts appear as the supervisor types, and once in the database, which
 * refuses to sign an entry that fails them. Two implementations can drift, so
 * these tests pin the client half against the same cases the SQL suite pins
 * the database half against.
 */

const empty = {
  labour: [],
  plant: [],
  work_items: [],
  variations: [],
  delays: [],
  pours: [],
  quantities: [],
  dayworks: [],
  sections: [],
  weather_impact: null,
};

const variation = (over = {}) => ({
  description: 'Extra rock breaking',
  directed_by: null,
  directed_at: null,
  vr_ref: null,
  estimated_cost: null,
  photo_urls: [],
  source_quote: null,
  confidence: null,
  ...over,
});

test('an empty entry has no blocking gaps — nothing to be wrong yet', () => {
  assert.deepEqual(reviewBlockingGaps(ReviewPayload.parse(empty)), []);
});

test('the four gates match the database, code for code', () => {
  const payload = ReviewPayload.parse({
    ...empty,
    variations: [variation()],
    pours: [{ location: 'Pier 3' }],
    delays: [{ cause: 'Rain', start_time: '09:30' }],
  });

  assert.deepEqual(reviewBlockingGaps(payload), [
    'delay_missing_times',
    'pour_missing_volume_m3',
    'variation_missing_vr_ref',
  ]);
});

test('every gap code has something to tell the supervisor', () => {
  const payload = ReviewPayload.parse({
    ...empty,
    variations: [variation()],
    pours: [{ location: 'Pier 3' }],
    delays: [{ cause: 'Rain' }],
  });

  for (const gap of reviewBlockingGaps(payload)) {
    const prompt = GAP_PROMPTS[gap];
    assert.ok(prompt, `${gap} has no prompt`);
    assert.ok(prompt.short.length > 5, `${gap} has no short prompt`);
    assert.ok(prompt.why.length > 5, `${gap} has no reason`);
    assert.ok(prompt.group, `${gap} is not attached to a section`);
  }
});

test('a photo is optional — with or without one, only the VR reference gates', () => {
  const withPhoto = ReviewPayload.parse({
    ...empty,
    variations: [variation({ photo_urls: ['proj/entry/vr.jpg'] })],
  });
  const withoutPhoto = ReviewPayload.parse({ ...empty, variations: [variation()] });
  assert.deepEqual(reviewBlockingGaps(withPhoto), ['variation_missing_vr_ref']);
  assert.deepEqual(reviewBlockingGaps(withoutPhoto), ['variation_missing_vr_ref']);
});

test('a delay needs both ends, not just one', () => {
  const oneEnd = ReviewPayload.parse({ ...empty, delays: [{ start_time: '09:30' }] });
  assert.deepEqual(reviewBlockingGaps(oneEnd), ['delay_missing_times']);

  const bothEnds = ReviewPayload.parse({
    ...empty,
    delays: [{ start_time: '09:30', end_time: '11:15' }],
  });
  assert.deepEqual(reviewBlockingGaps(bothEnds), []);
});

test('a pour of zero is a volume; a pour of null is not', () => {
  const zero = ReviewPayload.parse({ ...empty, pours: [{ location: 'A', volume_m3: 0 }] });
  assert.deepEqual(reviewBlockingGaps(zero), []);

  const missing = ReviewPayload.parse({ ...empty, pours: [{ location: 'A' }] });
  assert.deepEqual(reviewBlockingGaps(missing), ['pour_missing_volume_m3']);
});

test('whitespace is not a VR reference', () => {
  const payload = ReviewPayload.parse({
    ...empty,
    variations: [variation({ vr_ref: '   ', photo_urls: ['p/e/x.jpg'] })],
  });
  assert.deepEqual(reviewBlockingGaps(payload), ['variation_missing_vr_ref']);
});

// --- the contract ----------------------------------------------------------

test('an item the supervisor typed in carries no source quote or confidence', () => {
  const payload = ReviewPayload.parse({
    ...empty,
    labour: [{ person_name: 'Kel Brady', hours: 4 }],
  });

  assert.equal(payload.labour[0].source_quote, null);
  assert.equal(payload.labour[0].confidence, null);
  assert.equal(payload.labour[0].hours, 4);
});

test('a nameless item is rejected rather than stored as a blank row', () => {
  assert.equal(ReviewPayload.safeParse({ ...empty, labour: [{ person_name: '  ' }] }).success, false);
  assert.equal(ReviewPayload.safeParse({ ...empty, plant: [{ item: '' }] }).success, false);
});

test('a bad time is dropped rather than stored as nonsense', () => {
  const payload = ReviewPayload.parse({
    ...empty,
    delays: [{ cause: 'Rain', start_time: 'half nine', end_time: '11:15' }],
  });
  assert.equal(payload.delays[0].start_time, null);
  assert.equal(payload.delays[0].end_time, '11:15');
});

test('empty strings become null, so "not stated" stays not stated', () => {
  const payload = ReviewPayload.parse({
    ...empty,
    labour: [{ person_name: 'Danny Rowe', role: '', area: '   ' }],
  });
  assert.equal(payload.labour[0].role, null);
  assert.equal(payload.labour[0].area, null);
});

test('manual weather readings keep blanks as null', () => {
  const payload = ReviewPayload.parse({
    ...empty,
    weather: {
      temp_max: 23.4,
      temp_min: '',
      rainfall_mm: 0,
      wind_dir: '  WSW ',
      wind_kmh: null,
    },
  });

  assert.equal(payload.weather.temp_max, 23.4);
  assert.equal(payload.weather.temp_min, null);
  assert.equal(payload.weather.rainfall_mm, 0);
  assert.equal(payload.weather.wind_dir, 'WSW');
  assert.equal(payload.weather.wind_kmh, null);
});

test('dayworks keep photos and never invent missing hours', () => {
  const payload = ReviewPayload.parse({
    ...empty,
    dayworks: [
      {
        description: 'Expose and shore the existing Telstra conduit',
        labour: 'Kel and Toby',
        plant: '',
        materials: null,
        docket_ref: 'DW-017',
        photo_urls: ['project/entry/dayworks.jpg'],
      },
    ],
  });

  assert.equal(payload.dayworks[0].hours, null);
  assert.equal(payload.dayworks[0].plant, null);
  assert.deepEqual(payload.dayworks[0].photo_urls, ['project/entry/dayworks.jpg']);
  assert.deepEqual(reviewBlockingGaps(payload), []);
});

test('an extraction-shaped variation — no photo fields at all — parses and gates', () => {
  // The first real site recording contained a variation, and the raw
  // extraction shape (which never carries photo_urls) crashed the review
  // screen. This pins the boundary: parsing fills the defaults, and the gap
  // rules then demand the photo.
  const payload = ReviewPayload.parse({
    ...empty,
    variations: [
      {
        description: 'Additional pipe installed around the bus station',
        directed_by: null,
        directed_at: null,
        vr_ref: null,
        estimated_cost: null,
        source_quote: 'we had to put an additional pipe',
        confidence: 'high',
      },
    ],
    pours: [{ location: 'mainline', volume_m3: null, docket_nos: [] }],
  });

  assert.deepEqual(payload.variations[0].photo_urls, []);
  assert.deepEqual(payload.pours[0].docket_photo_urls, []);
  assert.deepEqual(reviewBlockingGaps(payload), [
    'pour_missing_volume_m3',
    'variation_missing_vr_ref',
  ]);
});

test('quality warnings catch soft review issues without becoming blocking gaps', () => {
  const payload = ReviewPayload.parse({
    ...empty,
    labour: [{ person_name: 'Danny Rowe' }],
    plant: [{ item: 'Excavator' }],
    delays: [{ category: 'weather', personnel_affected: 3, start_time: '09:00', end_time: '10:00' }],
    pours: [{ location: 'Slab', volume_m3: 6 }],
    variations: [{ ...variation({ vr_ref: 'VR-12', directed_by: null }) }],
    quantities: [{ item_type: 'Topsoil', quantity: 12 }],
  });

  assert.deepEqual(reviewBlockingGaps(payload), []);
  assert.deepEqual(reviewQualityWarnings(payload), [
    'delay_people_without_cause',
    'labour_missing_hours',
    'plant_missing_hours',
    'pour_volume_without_docket',
    'quantity_missing_unit',
    'variation_ref_without_directed_by',
    'weather_delay_without_impact',
  ]);
});

test('weather impact and low confidence get review warnings', () => {
  const payload = ReviewPayload.parse({
    ...empty,
    labour: [{ person_name: 'Danny Rowe', hours: 8, confidence: 'low' }],
    weather_impact: 'Rain slowed backfill.',
  });

  assert.deepEqual(reviewQualityWarnings(payload), [
    'low_confidence_items',
    'weather_impact_without_weather_delay',
  ]);
});

test('every quality warning has text for the supervisor', () => {
  const payload = ReviewPayload.parse({
    ...empty,
    labour: [{ person_name: 'Danny Rowe' }],
    weather_impact: 'Wind stopped crane lifts.',
  });

  for (const warning of reviewQualityWarnings(payload)) {
    assert.ok(WARNING_PROMPTS[warning], `${warning} has no prompt`);
    assert.ok(WARNING_PROMPTS[warning].length > 20, `${warning} prompt is too thin`);
  }
});
