import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreProposal, similarity, summarise } from './score.ts';
import { C, D, L, P, Q, S, V, proposal } from './fixtures/builders.ts';
import { FIXTURES } from './fixtures/transcripts.ts';
import { ExtractionProposal } from './schema.ts';

/**
 * The scorer is the instrument §10 measures prompt changes with. An untested
 * instrument produces numbers that feel like evidence and are not, so it is
 * checked against predictions whose right answer is known by construction.
 */

const clone = (p: ExtractionProposal): ExtractionProposal =>
  structuredClone(p) as ExtractionProposal;

test('a perfect prediction scores perfectly and invents nothing', () => {
  for (const fixture of FIXTURES) {
    const score = scoreProposal(fixture.expected, clone(fixture.expected));
    assert.equal(score.invented, 0, `${fixture.id} reported invention against itself`);
    assert.equal(score.values.wrong, 0, `${fixture.id} reported a wrong value against itself`);
    assert.equal(score.values.missed, 0, `${fixture.id} reported a miss against itself`);
    assert.equal(score.valueAccuracy, 1, `${fixture.id} did not score 1.0 against itself`);
    assert.equal(score.items.missed, 0);
    assert.equal(score.items.spurious, 0);
  }
});

test('a value that was never stated is counted as invented, not wrong', () => {
  const expected = proposal({ labour: [L('Danny Rowe')] });
  const predicted = proposal({ labour: [L('Danny Rowe', { hours: 8 })] });

  const score = scoreProposal(expected, predicted);

  assert.equal(score.values.invented, 1);
  assert.equal(score.values.missed, 0);
  assert.equal(score.values.wrong, 0);
  assert.equal(score.invented, 1);
});

test('a value that was stated and dropped is a miss, not an invention', () => {
  const expected = proposal({ labour: [L('Danny Rowe', { hours: 8 })] });
  const predicted = proposal({ labour: [L('Danny Rowe')] });

  const score = scoreProposal(expected, predicted);

  assert.equal(score.values.missed, 1);
  assert.equal(score.values.invented, 0);
  assert.equal(score.invented, 0);
});

test('a wrong number is neither a miss nor an invention', () => {
  const score = scoreProposal(
    proposal({ pours: [C({ location: 'Pier 3', volume_m3: 18 })] }),
    proposal({ pours: [C({ location: 'Pier 3', volume_m3: 21 })] }),
  );
  assert.equal(score.values.wrong, 1);
  assert.equal(score.values.missed, 0);
  assert.equal(score.values.invented, 0);
});

test('an item nobody mentioned counts as invented even with no values on it', () => {
  const score = scoreProposal(
    proposal({ labour: [L('Danny Rowe')] }),
    proposal({ labour: [L('Danny Rowe'), L('Nobody Atall')] }),
  );

  assert.equal(score.items.spurious, 1);
  assert.ok(score.invented >= 1, 'a conjured worker was not counted as invention');
});

test('a missing item counts its stated values as misses', () => {
  const score = scoreProposal(
    proposal({ labour: [L('Danny Rowe', { hours: 8 }), L('Sam Whitely', { hours: 9 })] }),
    proposal({ labour: [L('Danny Rowe', { hours: 8 })] }),
  );

  assert.equal(score.items.missed, 1);
  assert.equal(score.values.missed, 1);
  assert.equal(score.invented, 0);
});

test('order does not matter — nobody dictates a diary in a defined order', () => {
  const a = proposal({
    labour: [L('Danny Rowe', { hours: 8 }), L('Sam Whitely', { hours: 9 })],
  });
  const b = proposal({
    labour: [L('Sam Whitely', { hours: 9 }), L('Danny Rowe', { hours: 8 })],
  });
  assert.equal(scoreProposal(a, b).valueAccuracy, 1);
});

test('a partial name still matches the right person', () => {
  const score = scoreProposal(
    proposal({ labour: [L('Danny Rowe', { hours: 8 })] }),
    proposal({ labour: [L('Danny', { hours: 8 })] }),
  );
  assert.equal(score.items.matched, 1);
  assert.equal(score.items.spurious, 0);
  assert.equal(score.values.wrong, 0);
  assert.equal(score.valueAccuracy, 1);
});

test('free text is judged loosely and kept out of the value figure', () => {
  const score = scoreProposal(
    proposal({ delays: [D({ cause: 'Waiting on concrete truck', start_time: '09:30' })] }),
    proposal({ delays: [D({ cause: 'waiting on the concrete truck', start_time: '09:30' })] }),
  );

  assert.equal(score.text.wrong, 0, 'a reworded cause was scored as wrong');
  assert.equal(score.valueAccuracy, 1);
});

test('times, units and enums are compared strictly', () => {
  const wrongUnit = scoreProposal(
    proposal({ quantities: [Q('topsoil', { quantity: 400, unit: 'm2' })] }),
    proposal({ quantities: [Q('topsoil', { quantity: 400, unit: 'm3' })] }),
  );
  assert.equal(wrongUnit.values.wrong, 1);

  const wrongTime = scoreProposal(
    proposal({ delays: [D({ start_time: '09:30', cause: 'Rain' })] }),
    proposal({ delays: [D({ start_time: '21:30', cause: 'Rain' })] }),
  );
  assert.equal(wrongTime.values.wrong, 1);

  const wrongCategory = scoreProposal(
    proposal({ delays: [D({ category: 'weather', cause: 'Rain' })] }),
    proposal({ delays: [D({ category: 'access', cause: 'Rain' })] }),
  );
  assert.equal(wrongCategory.values.wrong, 1);
});

test('docket lists compare by contents, not order', () => {
  const score = scoreProposal(
    proposal({ pours: [C({ location: 'Pier 3', docket_nos: ['4471', '4472'] })] }),
    proposal({ pours: [C({ location: 'Pier 3', docket_nos: ['4472', '4471'] })] }),
  );
  assert.equal(score.values.wrong, 0);
  assert.equal(score.valueAccuracy, 1);
});

test('an invented docket number is caught', () => {
  const score = scoreProposal(
    proposal({ pours: [C({ location: 'Pier 3' })] }),
    proposal({ pours: [C({ location: 'Pier 3', docket_nos: ['4471'] })] }),
  );
  assert.equal(score.values.invented, 1);
});

test('a nil mistaken for a gap is scored as a wrong section state', () => {
  const expected = proposal({ sections: { plant: S.nil } });
  const predicted = proposal({ sections: { plant: S.gap } });

  const score = scoreProposal(expected, predicted);

  assert.equal(score.sectionStates.wrong, 1);
  assert.equal(score.sectionStates.correct, 5);
});

test('failures carry enough detail to act on', () => {
  const score = scoreProposal(
    proposal({ labour: [L('Danny Rowe')] }),
    proposal({ labour: [L('Danny Rowe', { hours: 12 })] }),
  );

  const failure = score.failures.find((f) => f.field === 'hours');
  assert.ok(failure);
  assert.equal(failure.section, 'labour');
  assert.equal(failure.verdict, 'invented');
  assert.equal(failure.actual, 12);
});

test('summarise adds up across the fixture set', () => {
  const scores = FIXTURES.map((f) => scoreProposal(f.expected, clone(f.expected)));
  const total = summarise(scores);

  assert.equal(total.invented, 0);
  assert.equal(total.valueAccuracy, 1);
  assert.equal(total.sectionAccuracy, 1);
  assert.equal(total.spuriousItems, 0);
});

test('similarity behaves the way the matcher needs it to', () => {
  assert.equal(similarity('Danny Rowe', 'danny rowe'), 1);
  assert.ok(similarity('Danny Rowe', 'Danny') >= 0.5);
  assert.ok(similarity('Danny Rowe', 'Sam Whitely') < 0.5);
  assert.equal(similarity('', 'Danny'), 0);
});
