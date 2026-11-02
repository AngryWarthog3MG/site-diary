import test from 'node:test';
import assert from 'node:assert/strict';
import { controlState, bestLevelInPlace, sortControls, hazardTypeOptions, hazardTypeLabel, summariseHazards, BUILT_IN_HAZARD_TYPES } from './controls.ts';

test('state is read off the controls: none, pending, controlled, eliminated — withdrawn ones do not count', () => {
  assert.equal(controlState([]), 'no_controls');
  assert.equal(controlState([{ level: 'ppe', status: 'planned' }]), 'control_pending');
  assert.equal(controlState([{ level: 'ppe', status: 'planned' }, { level: 'engineering', status: 'in_place' }]), 'controlled');
  assert.equal(controlState([{ level: 'elimination', status: 'in_place' }]), 'eliminated');
  assert.equal(controlState([{ level: 'elimination', status: 'withdrawn' }, { level: 'ppe', status: 'in_place' }]), 'controlled');
  assert.equal(controlState([{ level: 'engineering', status: 'withdrawn' }]), 'no_controls');
});

test('best level in place is the highest on the hierarchy; null with nothing in', () => {
  assert.equal(bestLevelInPlace([{ level: 'ppe', status: 'in_place' }, { level: 'isolation', status: 'in_place' }, { level: 'elimination', status: 'planned' }]), 'isolation');
  assert.equal(bestLevelInPlace([{ level: 'ppe', status: 'planned' }]), null);
});

test('controls sort in place first and best level first, then planned, then withdrawn', () => {
  const rows = sortControls([
    { level: 'ppe', status: 'planned', created_at: '1' }, { level: 'administrative', status: 'withdrawn', created_at: '2' },
    { level: 'ppe', status: 'in_place', created_at: '3' }, { level: 'engineering', status: 'in_place', created_at: '4' },
  ]);
  assert.deepEqual(rows.map((r) => `${r.status}:${r.level}`), ['in_place:engineering', 'in_place:ppe', 'planned:ppe', 'withdrawn:administrative']);
});

test('hazard types: built-in then the company\'s own, retired marked, and a label for a key either way', () => {
  const custom = [{ kind: 'hazard_type', key: 'tailings', label: 'Tailings', active: true }, { kind: 'hazard_type', key: 'old', label: 'Old', active: false }, { kind: 'root_cause', key: 'x_y', label: 'Not a type' }];
  const opts = hazardTypeOptions(custom);
  assert.equal(opts.length, BUILT_IN_HAZARD_TYPES.length + 2);
  assert.equal(opts.at(-1)?.label, 'Old (retired)');
  assert.equal(hazardTypeLabel('traffic'), 'Traffic and public interface');
  assert.equal(hazardTypeLabel('tailings', custom), 'Tailings');
  assert.equal(hazardTypeLabel('gone', custom), 'gone');
  assert.equal(hazardTypeLabel(null), null);
});

test('the register counts open hazards, the uncontrolled ones and the critical ones; closed and other kinds are out', () => {
  const s = summariseHazards([
    { kind: 'hazard', status: 'open', critical_risk: true, controls: [] },
    { kind: 'hazard', status: 'open', critical_risk: false, controls: [{ level: 'ppe', status: 'planned' }] },
    { kind: 'hazard', status: 'investigating', critical_risk: true, controls: [{ level: 'engineering', status: 'in_place' }] },
    { kind: 'hazard', status: 'closed', critical_risk: true, controls: [] },
    { kind: 'near_miss', status: 'open', critical_risk: true, controls: [] },
  ]);
  assert.deepEqual(s, { open: 3, uncontrolled: 2, critical: 2, criticalUncontrolled: 1 });
});
