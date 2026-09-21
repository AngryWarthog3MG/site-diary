import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inductionFor, inductionRows, notInducted, peopleOnJob, type Induction } from './inductions.ts';

const ind = (person_name: string, inducted_on: string, over: Partial<Induction> = {}): Induction => ({ person_name, inducted_on, notes: null, recorded_by: null, ...over });

test('everyone on the job once, members and roster together, blanks dropped', () => {
  assert.deepEqual(peopleOnJob(['Marcus Hayden', null, '  ', 'AJ'], ['marcus   hayden', 'Evan Burke']), ['AJ', 'Evan Burke', 'Marcus Hayden']);
});

test('an induction is found by name however it was cased or spaced', () => {
  const list = [ind('hamish hayden', '2026-09-15')];
  assert.equal(inductionFor(list, 'Hamish  Hayden')?.inducted_on, '2026-09-15');
  assert.equal(inductionFor(list, 'Hamish Haydon'), null);
});

test('the form offers the people with no induction first', () => {
  assert.deepEqual(notInducted(['AJ', 'Evan Burke', 'Marcus Hayden'], [ind('evan burke', '2026-09-01')]), ['AJ', 'Marcus Hayden']);
});

test('the list shows inducted people first, newest first, then the rest — and a visitor on no roster still counts', () => {
  const rows = inductionRows(['AJ', 'Evan Burke', 'Marcus Hayden'], [ind('Marcus Hayden', '2026-09-01'), ind('Evan Burke', '2026-09-10'), ind('Visitor Vic', '2026-09-05')]);
  assert.deepEqual(rows.map((r) => `${r.name}:${r.induction?.inducted_on ?? '-'}`), ['Evan Burke:2026-09-10', 'Visitor Vic:2026-09-05', 'Marcus Hayden:2026-09-01', 'AJ:-']);
});
