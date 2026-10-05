import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CORRECTION_COPY, copyColumns } from './correction-copy.ts';
import { ReviewDaywork, ReviewDelay, ReviewLabour, ReviewPayload, ReviewPhoto, ReviewPlant, ReviewPour, ReviewQuantity, ReviewSiteEvent, ReviewVariation, ReviewWorkItem } from './schema.ts';

const CONTRACT = {
  labour: ReviewLabour, plant: ReviewPlant, work_items: ReviewWorkItem, variations: ReviewVariation, delays: ReviewDelay,
  pours: ReviewPour, quantities: ReviewQuantity, dayworks: ReviewDaywork, site_events: ReviewSiteEvent, photos: ReviewPhoto,
} as const;

test('a correction carries every field the review contract carries, section by section', () => {
  for (const [table, schema] of Object.entries(CONTRACT)) {
    const copied = new Set<string>(CORRECTION_COPY[table as keyof typeof CORRECTION_COPY]);
    const missing = Object.keys(schema.shape).filter((k) => !copied.has(k));
    assert.deepEqual(missing, [], `${table}: a correction would drop ${missing.join(', ')}`);
  }
});

test('every row section of the payload is copied — none is left out whole', () => {
  const rowSections = Object.entries(ReviewPayload.shape)
    .filter(([key]) => key in CONTRACT || /^(labour|plant|work_items|variations|delays|pours|quantities|dayworks|site_events|photos)$/.test(key))
    .map(([key]) => key);
  for (const key of rowSections) assert.ok(key in CORRECTION_COPY, `${key} is in the payload but a correction does not copy it`);
  assert.ok('site_events' in CORRECTION_COPY);
});

test('the clocks travel with the labour row', () => {
  assert.match(copyColumns('labour'), /start_time, finish_time, break_mins/);
});
