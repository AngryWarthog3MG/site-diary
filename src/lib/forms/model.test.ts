import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  readSpec, templateProblems, nextRevision, answerFails, answered, score, completionProblems, outcome, specFromLines, summariseForms, answerText,
  type FormSpec,
} from './model.ts';

const FATIGUE: FormSpec = readSpec({
  header: [{ key: 'shift', label: 'Shift', type: 'select', options: ['Day', 'Night'] }],
  sections: [{ title: 'Before the shift', questions: [
    { key: 'slept', label: 'Slept 7 hours or more', type: 'yes_no', required: true, fail: 'no', raise_action: true },
    { key: 'alert', label: 'How alert do you feel', type: 'score', max: 5, fail: 3, required: true },
    { key: 'meds', label: 'Taking medication that affects alertness', type: 'yes_no', fail: 'yes', photo_required: true },
    { key: 'comment', label: 'Anything else', type: 'text' },
  ] }],
});

test('templateProblems mirrors the SQL: duplicate keys, empty sections, bad scales', () => {
  assert.deepEqual(templateProblems(FATIGUE), []);
  const dup = readSpec({ sections: [{ title: 'A', questions: [{ key: 'x', label: 'X', type: 'yes_no' }, { key: 'x', label: 'Y', type: 'yes_no' }] }] });
  assert.ok(templateProblems(dup).some((p) => p.includes('used twice')));
  assert.ok(templateProblems(readSpec({ sections: [] })).includes('The form has no questions.'));
  const badScore = readSpec({ sections: [{ title: 'A', questions: [{ key: 'x', label: 'X', type: 'score', max: 0 }] }] });
  assert.ok(templateProblems(badScore).some((p) => p.includes('between 1 and 100')));
  const noOptions = readSpec({ sections: [{ title: 'A', questions: [{ key: 'x', label: 'X', type: 'select' }] }] });
  assert.ok(templateProblems(noOptions).some((p) => p.includes('no options')));
  assert.ok(templateProblems(readSpec({ sections: [{ title: '', questions: [{ key: 'Bad Key', label: 'X', type: 'text' }] }] })).length >= 2);
});

test('nextRevision: A → B, Y → Z, Z → ZA', () => {
  assert.equal(nextRevision('A'), 'B');
  assert.equal(nextRevision('Y'), 'Z');
  assert.equal(nextRevision('Z'), 'ZA');
});

test('answerFails: per type, and unanswered never fails', () => {
  const q = FATIGUE.sections[0].questions;
  assert.equal(answerFails(q[0], { value: 'no' }), true);
  assert.equal(answerFails(q[0], { value: 'yes' }), false);
  assert.equal(answerFails(q[0], undefined), false);
  assert.equal(answerFails(q[1], { value: 2 }), true);
  assert.equal(answerFails(q[1], { value: 3 }), false);
  assert.equal(answerFails(q[2], { value: 'yes' }), true);
  assert.equal(answerFails({ key: 'n', label: 'N', type: 'number', min: 10, max: 20 }, { value: '25' }), true);
  assert.equal(answerFails({ key: 'n', label: 'N', type: 'number', min: 10, max: 20 }, { value: 15 }), false);
  assert.equal(answerFails({ key: 's', label: 'S', type: 'select', options: ['a', 'b'], fail_options: ['b'] }, { value: 'b' }), true);
  assert.equal(answerFails({ key: 'm', label: 'M', type: 'multi', options: ['a', 'b'], fail_options: ['b'] }, { value: ['a', 'b'] }), true);
  assert.equal(answerFails({ key: 'm', label: 'M', type: 'multi', options: ['a', 'b'], fail_options: ['b'] }, { value: ['a'] }), false);
  assert.equal(answered({ key: 'p', label: 'P', type: 'photo' }, { photo_paths: [] }), false);
  assert.equal(answered({ key: 'p', label: 'P', type: 'photo' }, { photo_paths: ['x/y.jpg'] }), true);
});

test('score and outcome agree with suite 70: alert 2 of 5 → 40.0, fails on a failing answer', () => {
  const answers = { slept: { value: 'no' }, alert: { value: 2 }, meds: { value: 'yes', photo_paths: ['p/form/s/meds.jpg'] } };
  assert.equal(score(FATIGUE, answers), 40);
  assert.equal(outcome(FATIGUE, answers, 60), 'fail');
  assert.equal(score(FATIGUE, { alert: { value: 5 } }), 100);
  assert.equal(outcome(FATIGUE, { slept: { value: 'yes' }, alert: { value: 5 } }, 60), 'pass');
  // Under the pass mark with nothing failing is still a fail.
  const scored = readSpec({ sections: [{ title: 'S', questions: [{ key: 'a', label: 'A', type: 'score', max: 10 }] }] });
  assert.equal(outcome(scored, { a: { value: 5 } }, 60), 'fail');
  assert.equal(score(scored, {}), null);
  assert.equal(outcome(scored, {}, 60), 'pass');
});

test('completionProblems: required, photo on a fail, subject and signature', () => {
  const ctx = { subject: 'none' as const, subjectPlantId: null, subjectPerson: null, signatureRule: 'required' as const, hasSignature: true };
  assert.deepEqual(completionProblems(FATIGUE, { slept: { value: 'no' } }, ctx), ['"How alert do you feel" is not answered.']);
  assert.deepEqual(completionProblems(FATIGUE, { slept: { value: 'no' }, alert: { value: 2 }, meds: { value: 'yes' } }, ctx), ['"Taking medication that affects alertness" failed and needs a photograph.']);
  assert.deepEqual(completionProblems(FATIGUE, { slept: { value: 'no' }, alert: { value: 2 } }, { ...ctx, subject: 'person', hasSignature: false }), ['Who the form is about.', 'The signature.']);
  assert.deepEqual(completionProblems(FATIGUE, { slept: { value: 'no' }, alert: { value: 2 } }, { ...ctx, signatureRule: 'none', hasSignature: false }), []);
});

test('specFromLines: # opens a section, lines become OK/Issue/N/A questions with unique keys', () => {
  const s = specFromLines('# Cab\nSeat belt works\nSeat belt works\n\n# Outside\nTracks: no cracks');
  assert.equal(s.sections.length, 2);
  assert.deepEqual(s.sections[0].questions.map((q) => q.key), ['seat_belt_works', 'seat_belt_works_2']);
  assert.equal(s.sections[1].questions[0].type, 'ok_issue_na');
  assert.deepEqual(templateProblems(s), []);
  assert.equal(specFromLines('Just one').sections[0].title, 'Checks');
});

test('summariseForms and answerText', () => {
  const sum = summariseForms(
    [{ status: 'completed', outcome: 'fail', completed_at: 'x' }, { status: 'completed', outcome: 'pass', completed_at: 'y' }, { status: 'open', outcome: null, completed_at: null }],
    [{ status: 'open', raised_as_action: true, due_on: '2026-10-01', done_at: null }, { status: 'open', raised_as_action: false, due_on: '2026-10-01', done_at: null }, { status: 'resolved', raised_as_action: true, due_on: null, done_at: 'z' }],
    '2026-11-02',
  );
  assert.deepEqual(sum, { completed: 2, open: 1, failed: 1, ncOpen: 2, ncOverdue: 1 });
  const q = FATIGUE.sections[0].questions;
  assert.equal(answerText(q[1], { value: 2 }), '2 / 5');
  assert.equal(answerText(q[0], undefined), '—');
  assert.equal(answerText({ key: 'n', label: 'N', type: 'number', unit: 'mm' }, { value: 12 }), '12 mm');
});
