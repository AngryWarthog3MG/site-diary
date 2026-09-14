import test from 'node:test';
import assert from 'node:assert/strict';
import { readSteps, riskRating, swmsProblems, swmsWarnings, HRCW_CATEGORIES } from './model.ts';

test('the matrix rates like the civil form', () => {
  assert.equal(riskRating('rare', 'insignificant'), 'low');
  assert.equal(riskRating('possible', 'moderate'), 'high');
  assert.equal(riskRating('almost_certain', 'catastrophic'), 'extreme');
  assert.equal(riskRating('unlikely', 'major'), 'high');
});

test('stored steps read back tolerant of junk', () => {
  const steps = readSteps([{ step: 'Dig', hazards: 'Services', risk_before: 'high', controls: 'DBYD, pothole', risk_after: 'bogus', who: '' }, 'junk', null]);
  assert.equal(steps.length, 3);
  assert.deepEqual(steps[0], { step: 'Dig', hazards: 'Services', risk_before: 'high', controls: 'DBYD, pothole', risk_after: null, who: null });
  assert.equal(steps[1].step, '');
});

test('what stops a draft being put into use mirrors the database rule', () => {
  assert.deepEqual(swmsProblems({ kind: 'swms', hrcw: [], prepared_by: null, steps: [] }), [
    'no steps', 'a SWMS must name its high-risk construction work', 'nobody is named as having prepared it',
  ]);
  assert.deepEqual(
    swmsProblems({ kind: 'jsa', hrcw: [], prepared_by: 'Matty', steps: [{ step: 'Set up', hazards: '', risk_before: null, controls: 'Cones', risk_after: null, who: null }] }),
    ['step 1 names no hazard'],
  );
  assert.deepEqual(
    swmsProblems({ kind: 'swms', hrcw: ['shaft_trench'], prepared_by: 'Matty', steps: [{ step: 'Dig', hazards: 'Collapse', risk_before: 'high', controls: 'Batter, shore', risk_after: 'low', who: null }] }),
    [],
  );
});

test('warnings question a control that made things worse', () => {
  const w = swmsWarnings({ kind: 'jsa', hrcw: [], prepared_by: 'x', steps: [{ step: 'a', hazards: 'b', risk_before: 'low', controls: 'c', risk_after: 'extreme', who: null }] });
  assert.equal(w.length, 2);
});

test('the eighteen high-risk categories are all there', () => {
  assert.equal(HRCW_CATEGORIES.length, 18);
  assert.equal(new Set(HRCW_CATEGORIES.map((c) => c.key)).size, 18);
});
