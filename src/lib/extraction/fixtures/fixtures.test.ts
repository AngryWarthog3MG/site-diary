import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIXTURES } from './transcripts.ts';
import { ExtractionProposal, SECTION_KEYS } from '../schema.ts';
import { reconcileSections } from '../completeness.ts';

/**
 * The fixture set is the measuring stick (brief §10). A fixture that
 * contradicts itself, or one that does not match the contract, produces
 * confident numbers about nothing — so the set is checked before it is ever
 * used to judge a prompt.
 */

test('every fixture has a unique id', () => {
  assert.ok(FIXTURES.length >= 22, `only ${FIXTURES.length} fixtures`);
  assert.equal(new Set(FIXTURES.map((f) => f.id)).size, FIXTURES.length);
});

test('a morning brief records nothing — the diary is not a plan', () => {
  // Every other fixture is a knock-off report in past tense, which is exactly
  // why the first real recording caught the app out: it was a morning brief,
  // and the extraction wrote down work that had not started.
  const brief = FIXTURES.find((f) => f.id === '21-morning-brief')!;
  const items = [
    brief.expected.labour, brief.expected.plant, brief.expected.work_items,
    brief.expected.variations, brief.expected.delays, brief.expected.pours,
    brief.expected.quantities,
  ];
  assert.ok(items.every((group) => group.length === 0), 'a plan produced record items');
  assert.equal(brief.expected.weather_impact, null, 'a forecast became weather_impact');
  assert.ok(
    SECTION_KEYS.every((k) => brief.expected.sections[k].state === 'gap'),
    'a morning brief should leave every section unanswered',
  );

  const mixed = FIXTURES.find((f) => f.id === '22-mixed-tense')!;
  assert.equal(mixed.expected.pours.length, 1, 'the pour that happened should be recorded');
  assert.equal(mixed.expected.pours[0].volume_m3, 8);
  assert.equal(mixed.expected.work_items.length, 1, 'only the completed work belongs');
});

/**
 * Fixtures leave source_quote empty: it is not scored by value, because the
 * useful check is whether the model's quote appears verbatim in the transcript
 * — which the eval does directly. The contract still requires a non-empty
 * quote from the model, so the placeholder is filled before validating rather
 * than the schema being loosened to accommodate a fixture convention.
 */
function withPlaceholderQuotes(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withPlaceholderQuotes);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, inner]) =>
        key === 'source_quote' && inner === ''
          ? [key, 'placeholder']
          : [key, withPlaceholderQuotes(inner)],
      ),
    );
  }
  return value;
}

test('every expected result satisfies the JSON contract', () => {
  for (const fixture of FIXTURES) {
    const parsed = ExtractionProposal.safeParse(withPlaceholderQuotes(fixture.expected));
    assert.ok(
      parsed.success,
      `${fixture.id} does not match the schema: ${
        parsed.success ? '' : JSON.stringify(parsed.error.issues, null, 2)
      }`,
    );
  }
});

test('no fixture contradicts itself', () => {
  for (const fixture of FIXTURES) {
    const { corrections } = reconcileSections(fixture.expected);
    assert.deepEqual(
      corrections,
      [],
      `${fixture.id} declares section states its own items disagree with: ${corrections.join('; ')}`,
    );
  }
});

test('every fixture has a real transcript, date and stated purpose', () => {
  for (const fixture of FIXTURES) {
    assert.ok(fixture.transcript.trim().length > 20, `${fixture.id} transcript is too short`);
    assert.match(fixture.entryDate, /^\d{4}-\d{2}-\d{2}$/, `${fixture.id} has a bad entry date`);
    assert.ok(fixture.tests.trim().length > 10, `${fixture.id} does not say what it tests`);
  }
});

test('times in expected results are on a 24-hour clock', () => {
  const clock = /^([01]\d|2[0-3]):[0-5]\d$/;
  for (const fixture of FIXTURES) {
    for (const delay of fixture.expected.delays) {
      if (delay.start_time) assert.match(delay.start_time, clock, fixture.id);
      if (delay.end_time) assert.match(delay.end_time, clock, fixture.id);
    }
    for (const pour of fixture.expected.pours) {
      if (pour.start_time) assert.match(pour.start_time, clock, fixture.id);
      if (pour.finish_time) assert.match(pour.finish_time, clock, fixture.id);
    }
  }
});

test('units in expected results are already normalised', () => {
  const allowed = new Set(['m', 'm2', 'm3', 'mm', 'no', 't', 'kg', 'ea']);
  for (const fixture of FIXTURES) {
    for (const quantity of fixture.expected.quantities) {
      if (quantity.unit) {
        assert.ok(
          allowed.has(quantity.unit),
          `${fixture.id} expects unnormalised unit "${quantity.unit}"`,
        );
      }
    }
  }
});

test('the set covers the messy cases §10 names', () => {
  const all = FIXTURES.map((f) => `${f.id} ${f.tests}`.toLowerCase()).join('\n');
  for (const trait of ['correction', 'casual time', 'nil', 'hedged', 'mangled', 'interrupt']) {
    assert.ok(all.includes(trait), `no fixture covers "${trait}"`);
  }

  // The two that exist purely to catch invention.
  const partial = FIXTURES.find((f) => f.id === '16-partial-hours')!;
  assert.equal(partial.expected.labour.length, 4);
  assert.equal(
    partial.expected.labour.filter((l) => l.hours == null).length,
    2,
    'the partial-hours fixture must leave two workers without hours',
  );

  const noDocket = FIXTURES.find((f) => f.id === '19-pour-no-volume')!;
  assert.equal(noDocket.expected.pours[0].volume_m3, null);
  assert.deepEqual(noDocket.expected.pours[0].docket_nos, []);
});

test('at least one fixture confirms a nil and at least one leaves a gap', () => {
  const states = FIXTURES.flatMap((f) => SECTION_KEYS.map((k) => f.expected.sections[k].state));
  assert.ok(states.includes('nil_confirmed'), 'nothing exercises a confirmed nil');
  assert.ok(states.includes('gap'), 'nothing exercises a gap');
  assert.ok(states.includes('captured'), 'nothing exercises a captured section');
});
