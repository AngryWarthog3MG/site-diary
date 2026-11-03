import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_MATRIX, LIKELIHOOD, CONSEQUENCE, readMatrix, riskLevelOn, riskScore, reviewDue, reviewStatus, perthDay, riskRef, ratingText,
  riskProblems, riskControlState, bestControlInPlace, sortRisks, summariseRisks, gaugeLevel, proposeFromSwms,
  type RiskRow, type ControlRow,
} from './model.ts';
import { riskRating } from '../swms/model.ts';

const risk = (over: Partial<RiskRow> = {}): RiskRow => ({
  id: 'r1', org_id: 'o', profile_id: 'p', seq: 1, task: 'Trenching', step: 'Open the trench', hazard: 'Collapse', hazard_type: 'excavation', unwanted_event: 'Worker buried',
  inherent_likelihood: 'likely', inherent_consequence: 'catastrophic', inherent_level: 'extreme',
  residual_likelihood: 'unlikely', residual_consequence: 'major', residual_level: 'high',
  potential_likelihood: 'rare', potential_consequence: 'major', potential_level: 'medium',
  critical: true, owner_name: 'Sue', assigned_to: null, status: 'open', closed_at: null, closed_reason: null, source_swms_id: null, source_step: null, notes: null,
  created_at: '2026-11-03T01:00:00Z', ...over,
});
const control = (over: Partial<ControlRow> = {}): ControlRow => ({
  id: 'c1', risk_id: 'r1', description: 'Bench and batter', level: 'engineering', kind: 'existing', critical: true, status: 'in_place', due_on: null, priority: 'normal',
  owner_name: null, assigned_to: null, in_place_at: '2026-11-03T01:00:00Z', in_place_note: null, withdrawn_at: null, withdrawn_reason: null, created_at: '2026-11-03T01:00:00Z', ...over,
});

test('the default matrix is the SWMS matrix, cell for cell', () => {
  for (const l of LIKELIHOOD) for (const c of CONSEQUENCE) assert.equal(riskLevelOn(DEFAULT_MATRIX, l, c), riskRating(l, c), `${l} × ${c}`);
});

test('readMatrix: the company\'s cells when whole, the default when malformed', () => {
  const own = DEFAULT_MATRIX.map((r) => [...r]); own[0][0] = 'medium';
  assert.equal(riskLevelOn(readMatrix(own), 'rare', 'insignificant'), 'medium');
  assert.equal(readMatrix(null), DEFAULT_MATRIX);
  assert.equal(readMatrix([['low']]), DEFAULT_MATRIX);
  assert.equal(readMatrix(DEFAULT_MATRIX.map((r, i) => (i === 2 ? [...r.slice(0, 4), 'severe'] : [...r]))), DEFAULT_MATRIX);
});

test('riskScore: likelihood × consequence 1–25, null when half is unstated', () => {
  assert.equal(riskScore('rare', 'insignificant'), 1);
  assert.equal(riskScore('almost_certain', 'catastrophic'), 25);
  assert.equal(riskScore('possible', 'major'), 12);
  assert.equal(riskScore(null, 'major'), null);
  assert.equal(riskScore('possible', null), null);
});

test('reviewDue: from the last review, else the Perth day it was made, by the interval; month ends clamp; archived is null', () => {
  const p = { status: 'current' as const, created_at: '2026-01-30T23:30:00Z', review_interval_months: 1 };
  assert.equal(perthDay(p.created_at), '2026-01-31');
  assert.equal(reviewDue(p, null), '2026-02-28');
  assert.equal(reviewDue({ ...p, review_interval_months: 12 }, '2026-05-10'), '2027-05-10');
  assert.equal(reviewDue({ ...p, status: 'archived' }, '2026-05-10'), null);
  assert.equal(reviewStatus('2026-11-02', '2026-11-03'), 'overdue');
  assert.equal(reviewStatus('2026-12-03', '2026-11-03'), 'due_soon');
  assert.equal(reviewStatus('2026-12-04', '2026-11-03'), 'ok');
  assert.equal(reviewStatus(null, '2026-11-03'), 'none');
});

test('riskRef and ratingText', () => {
  assert.equal(riskRef(7), 'RSK-007');
  assert.equal(ratingText('high', 'unlikely', 'major'), 'High (Unlikely · Major)');
  assert.equal(ratingText('high', null, null), 'High');
  assert.equal(ratingText(null, null, null), '—');
});

test('riskProblems: task and hazard, and each rating whole or absent', () => {
  assert.deepEqual(riskProblems(risk()), []);
  assert.deepEqual(riskProblems(risk({ inherent_likelihood: null, inherent_consequence: null, inherent_level: 'high' })), []);
  const bad = riskProblems(risk({ task: ' ', hazard: '', inherent_consequence: null, residual_likelihood: null, potential_consequence: null }));
  assert.equal(bad.length, 5, bad.join(' | '));
  assert.ok(riskProblems(risk({ inherent_likelihood: null, inherent_consequence: null, inherent_level: '' as never })).some((p) => p.startsWith('Rate the inherent')));
});

test('riskControlState and bestControlInPlace: withdrawn controls do not count; the highest rung in place wins', () => {
  assert.equal(riskControlState([]), 'no_controls');
  assert.equal(riskControlState([control({ status: 'withdrawn' })]), 'no_controls');
  assert.equal(riskControlState([control({ kind: 'planned', status: 'planned' })]), 'planned_only');
  assert.equal(riskControlState([control({ kind: 'planned', status: 'planned' }), control({ id: 'c2' })]), 'controlled');
  assert.equal(bestControlInPlace([control({ level: 'ppe' }), control({ id: 'c2', level: 'isolation' }), control({ id: 'c3', level: 'elimination', status: 'withdrawn' })]), 'isolation');
  assert.equal(bestControlInPlace([control({ level: null })]), null);
});

test('sortRisks: open first, worst residual (else inherent) first, then by number', () => {
  const rows = [
    risk({ id: 'a', seq: 3, residual_level: 'low' }),
    risk({ id: 'b', seq: 1, status: 'closed', residual_level: 'extreme' }),
    risk({ id: 'c', seq: 2, residual_level: null, inherent_level: 'high' }),
    risk({ id: 'd', seq: 4, residual_level: 'high' }),
  ];
  assert.deepEqual(sortRisks(rows).map((r) => r.id), ['c', 'd', 'a', 'b']);
});

test('summariseRisks: the gauges — averages over the pairs given, level counts per rating, uncontrolled and planned controls', () => {
  const risks = [
    risk(),
    risk({ id: 'r2', seq: 2, critical: false, inherent_likelihood: null, inherent_consequence: null, inherent_level: 'medium', residual_likelihood: null, residual_consequence: null, residual_level: 'low', potential_likelihood: null, potential_consequence: null, potential_level: null }),
    risk({ id: 'r3', seq: 3, status: 'closed' }),
  ];
  const controls = [
    control(),
    control({ id: 'c2', risk_id: 'r1', kind: 'planned', status: 'planned', due_on: '2026-10-01' }),
    control({ id: 'c3', risk_id: 'r1', kind: 'planned', status: 'planned', due_on: '2026-12-01' }),
  ];
  const s = summariseRisks(risks, controls, '2026-11-03');
  assert.equal(s.open, 2); assert.equal(s.closed, 1); assert.equal(s.critical, 1);
  assert.equal(s.uncontrolled, 1); assert.equal(s.criticalUncontrolled, 0);
  assert.equal(s.highResidual, 1);
  assert.deepEqual(s.averages, { inherent: 20, residual: 8, potential: 4 });
  assert.deepEqual(s.levels.inherent, { low: 0, medium: 1, high: 0, extreme: 1 });
  assert.deepEqual(s.levels.residual, { low: 1, medium: 0, high: 1, extreme: 0 });
  assert.deepEqual(s.levels.potential, { low: 0, medium: 1, high: 0, extreme: 0 });
  assert.equal(s.controlsPlanned, 2); assert.equal(s.controlsOverdue, 1);
  assert.equal(summariseRisks([], [], '2026-11-03').averages.inherent, null);
});

test('gaugeLevel bands', () => {
  assert.equal(gaugeLevel(null), null);
  assert.equal(gaugeLevel(1), 'low'); assert.equal(gaugeLevel(3.9), 'low');
  assert.equal(gaugeLevel(4), 'medium'); assert.equal(gaugeLevel(8), 'high'); assert.equal(gaugeLevel(15), 'extreme');
});

test('proposeFromSwms: one risk per rated step with a hazard, levels only, the controls verbatim; already-held and unrated steps skipped', () => {
  const steps = [
    { step: 'Set up', hazards: 'Traffic', risk_before: 'high' as const, controls: 'TMP in place; spotter', risk_after: 'medium' as const },
    { step: 'Dig', hazards: '', risk_before: 'high' as const, controls: '', risk_after: null },
    { step: 'Backfill', hazards: 'Dust', risk_before: null, controls: 'Water cart', risk_after: 'low' as const },
    { step: 'Compact', hazards: 'Noise', risk_before: 'medium' as const, controls: '  ', risk_after: null },
  ];
  const { risks, skipped } = proposeFromSwms(' Trench works ', steps, [{ source_step: 4 }]);
  assert.equal(skipped, 2);
  assert.deepEqual(risks, [{ task: 'Trench works', step: 'Set up', hazard: 'Traffic', inherent_level: 'high', residual_level: 'medium', control: 'TMP in place; spotter', source_step: 1 }]);
});
