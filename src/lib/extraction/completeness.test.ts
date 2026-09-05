import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyStandardDay,
  STANDARD_DAY_START,
  STANDARD_DAY_FINISH,
  STANDARD_DAY_HOURS,
  followUpQuestions,
  itemCount,
  lowConfidenceCount,
  proposalBlockingGaps,
  reconcileSections,
} from './completeness.ts';
import { emptyProposal } from './schema.ts';
import { C, D, L, P, S, V, proposal } from './fixtures/builders.ts';

test('an empty entry asks about all six sections', () => {
  const questions = followUpQuestions(emptyProposal());
  assert.equal(questions.length, 6);
  assert.deepEqual(
    questions.map((q) => q.section),
    ['labour', 'plant', 'work_items', 'variations', 'delays', 'weather'],
  );
});

test('a confirmed nil is an answer and is not asked about again', () => {
  const p = proposal({
    labour: [L('Danny Rowe', { hours: 8 })],
    sections: { plant: S.nil },
  });
  const asked = followUpQuestions(p).map((q) => q.section);

  assert.ok(!asked.includes('plant'), 'a confirmed nil was asked about');
  assert.ok(!asked.includes('labour'), 'a captured section was asked about');
  assert.ok(asked.includes('variations'), 'an untouched section was not asked about');
});

test('the questions are fixed wording, not generated', () => {
  const a = followUpQuestions(emptyProposal());
  const b = followUpQuestions(emptyProposal());
  assert.deepEqual(a, b);
  assert.match(a.find((q) => q.section === 'plant')!.question, /nothing on plant today/i);
});

// --- reconciliation --------------------------------------------------------

test('items outrank a contradicting section label', () => {
  const contradictory = proposal({ labour: [L('Danny Rowe', { hours: 8 })] });
  contradictory.sections.labour = { state: 'gap', source_quote: null };

  const { proposal: fixed, corrections } = reconcileSections(contradictory);

  assert.equal(fixed.sections.labour.state, 'captured');
  assert.equal(corrections.length, 1);
  assert.match(corrections[0], /labour/);
});

test('a section marked captured with nothing in it becomes a gap', () => {
  const empty = emptyProposal();
  empty.sections.plant = { state: 'captured', source_quote: null };

  const { proposal: fixed, corrections } = reconcileSections(empty);

  assert.equal(fixed.sections.plant.state, 'gap');
  assert.equal(corrections.length, 1);
});

test('a confirmed nil is never overridden — it is the supervisor’s own answer', () => {
  const p = emptyProposal();
  p.sections.plant = { state: 'nil_confirmed', source_quote: 'no plant on site today' };

  const { proposal: fixed, corrections } = reconcileSections(p);

  assert.equal(fixed.sections.plant.state, 'nil_confirmed');
  assert.deepEqual(corrections, []);
});

test('reconciliation does not mutate its input', () => {
  const original = proposal({ plant: [P('Bobcat')] });
  original.sections.plant = { state: 'gap', source_quote: null };

  reconcileSections(original);

  assert.equal(original.sections.plant.state, 'gap', 'the input was mutated');
});

test('weather counts as captured when an impact was described', () => {
  const p = proposal({ weather_impact: 'Rain stopped the pour' });
  assert.equal(itemCount(p, 'weather'), 1);
  assert.equal(reconcileSections(p).proposal.sections.weather.state, 'captured');
});

// --- blocking gaps ---------------------------------------------------------

test('blocking gaps mirror the database gates', () => {
  const p = proposal({
    variations: [V('Extra rock breaking')],
    pours: [C({ location: 'Pier 3' })],
    delays: [D({ start_time: '09:30' })],
  });

  assert.deepEqual(proposalBlockingGaps(p), [
    'delay_missing_times',
    'pour_missing_volume_m3',
    'variation_missing_vr_ref',
  ]);
});

test('a photo is optional; the VR reference is what gates a variation', () => {
  // Owner decision, 2026-08-27.
  const p = proposal({ variations: [V('Extra work', { vr_ref: 'VR-014' })] });
  assert.deepEqual(proposalBlockingGaps(p), []);
});

test('an unstated day becomes the standard day; anything stated is kept', () => {
  const { proposal: filled, defaulted } = applyStandardDay(
    proposal({
      labour: [
        L('Matty'),
        L('Markus', { hours: 6 }),
        L('Hamish'),
        // Someone who started early but whose finish nobody gave: the
        // stated time survives, only the missing half is filled.
        L('Evan', { start_time: '05:00' }),
      ],
    }),
  );
  assert.equal(defaulted, 3);
  assert.deepEqual(filled.labour.map((l) => l.hours), [
    STANDARD_DAY_HOURS, 6, STANDARD_DAY_HOURS, STANDARD_DAY_HOURS,
  ]);
  assert.deepEqual(filled.labour.map((l) => l.start_time), [
    STANDARD_DAY_START, null, STANDARD_DAY_START, '05:00',
  ]);
  assert.deepEqual(filled.labour.map((l) => l.finish_time), [
    STANDARD_DAY_FINISH, null, STANDARD_DAY_FINISH, STANDARD_DAY_FINISH,
  ]);
  // The policy itself, so a change to it is a deliberate edit here too.
  assert.equal(STANDARD_DAY_START, '06:30');
  assert.equal(STANDARD_DAY_FINISH, '16:30');
  assert.equal(STANDARD_DAY_HOURS, 10);
});

test('a complete entry has no blocking gaps', () => {
  const p = proposal({
    pours: [C({ location: 'Pier 3', volume_m3: 18 })],
    delays: [D({ start_time: '09:30', end_time: '11:15' })],
    variations: [V('Extra work', { vr_ref: 'VR-014' })],
  });
  assert.deepEqual(proposalBlockingGaps(p), []);
});

test('low-confidence items are counted across every section', () => {
  const p = proposal({
    labour: [L('Danny Rowe', { confidence: 'low' }), L('Sam Whitely')],
    plant: [P('Bobcat', { confidence: 'low' })],
    pours: [C({ confidence: 'low' })],
  });
  assert.equal(lowConfidenceCount(p), 3);
});
