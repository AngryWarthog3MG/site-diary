import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  lotCloseProblems, holdsAwaitingRelease, testingAllowed, ncrReportState, calibrationStatus, calibratedOn,
  latestChecks, pointProblems, lotRef, ncrRef, type PointFacts,
} from './model.ts';

const points: PointFacts[] = [
  { id: 'p1', seq: 1, inspection_test: 'Compaction', point_type: 'hold', uses_calibrated_equipment: true },
  { id: 'p2', seq: 2, inspection_test: 'Level', point_type: 'witness', uses_calibrated_equipment: false },
];

test('references read like the register', () => {
  assert.equal(lotRef(7), 'LOT-007');
  assert.equal(ncrRef(12), 'NCR-012');
});

test('the latest check per point wins, by when it was recorded', () => {
  const m = latestChecks([
    { itp_point_id: 'p1', result: 'does_not_conform', created_at: '2026-09-16T01:00:00Z' },
    { itp_point_id: 'p1', result: 'conforms', created_at: '2026-09-16T03:00:00Z' },
  ]);
  assert.equal(m.get('p1')?.result, 'conforms');
});

test('a lot closes only with every point resulted, none failing, every hold released and no open NCR', () => {
  const none = lotCloseProblems(points, [], new Set(), []);
  assert.equal(none.length, 3);
  const good = lotCloseProblems(points, [
    { itp_point_id: 'p1', result: 'conforms', created_at: 'a' },
    { itp_point_id: 'p2', result: 'na', created_at: 'a' },
  ], new Set(['p1']), []);
  assert.deepEqual(good, []);
  const openNcr = lotCloseProblems(points, [
    { itp_point_id: 'p1', result: 'conforms', created_at: 'a' },
    { itp_point_id: 'p2', result: 'conforms', created_at: 'a' },
  ], new Set(['p1']), [{ itp_point_id: null, status: 'approved', disposition: 'repair' }]);
  assert.deepEqual(openNcr, ['A non-conformance on this lot is not closed.']);
});

test('a failed point closes only under a closed use-as-is concession on that point', () => {
  const checks = [{ itp_point_id: 'p1', result: 'conforms' as const, created_at: 'a' }, { itp_point_id: 'p2', result: 'does_not_conform' as const, created_at: 'a' }];
  assert.ok(lotCloseProblems(points, checks, new Set(['p1']), [{ itp_point_id: 'p2', status: 'closed', disposition: 'repair' }]).some((p) => p.includes('does not conform')));
  assert.deepEqual(lotCloseProblems(points, checks, new Set(['p1']), [{ itp_point_id: 'p2', status: 'closed', disposition: 'use_as_is' }]), []);
});

test('a hold point awaits release once it conforms and nobody has signed it off', () => {
  const checks = [{ itp_point_id: 'p1', result: 'conforms' as const, created_at: 'a' }];
  assert.deepEqual(holdsAwaitingRelease(points, checks, new Set()).map((p) => p.id), ['p1']);
  assert.deepEqual(holdsAwaitingRelease(points, checks, new Set(['p1'])), []);
  assert.deepEqual(holdsAwaitingRelease(points, [], new Set()), []);
});

test('no further testing on a lot on hold until an NCR exists and none is still open', () => {
  assert.equal(testingAllowed('open', []), true);
  assert.equal(testingAllowed('nonconforming', []), false);
  assert.equal(testingAllowed('nonconforming', [{ itp_point_id: null, status: 'open', disposition: null }]), false);
  assert.equal(testingAllowed('nonconforming', [{ itp_point_id: null, status: 'approved', disposition: 'repair' }]), true);
  assert.equal(testingAllowed('conforming', []), false);
});

test('the reporting clock is the contract\'s: none set, nothing to be late for', () => {
  assert.deepEqual(ncrReportState('2026-09-16T01:00:00Z', null, null, '2026-09-20T00:00:00Z'), { state: 'no_clock', dueAt: null });
  assert.equal(ncrReportState('2026-09-16T01:00:00Z', null, 24, '2026-09-17T00:59:00Z').state, 'due');
  assert.equal(ncrReportState('2026-09-16T01:00:00Z', null, 24, '2026-09-17T01:01:00Z').state, 'overdue');
  assert.equal(ncrReportState('2026-09-16T01:00:00Z', null, 24, '2026-09-17T01:01:00Z').dueAt, '2026-09-17T01:00:00.000Z');
  assert.equal(ncrReportState('2026-09-16T01:00:00Z', '2026-09-16T05:00:00Z', 24, '2026-09-20T00:00:00Z').state, 'reported');
});

test('calibration is judged by the calibration that runs latest, and by the day of use', () => {
  const cals = [
    { calibrated_on: '2025-01-01', due_on: '2026-01-01', certificate_no: 'A' },
    { calibrated_on: '2026-01-02', due_on: '2026-10-01', certificate_no: 'B' },
  ];
  assert.equal(calibrationStatus(cals, '2026-09-16').status, 'due_soon');
  assert.equal(calibrationStatus(cals, '2026-10-02').status, 'expired');
  assert.equal(calibrationStatus([], '2026-09-16').status, 'none');
  assert.equal(calibratedOn(cals, '2026-01-01'), true);
  assert.equal(calibratedOn(cals, '2026-10-02'), false);
});

test('a point is not ready until it names the process, the test, the criteria, the frequency, who, and its kind', () => {
  assert.equal(pointProblems({ activity: '', inspection_test: '', acceptance_criteria: '', frequency: '', responsible: '', point_type: '' }).length, 6);
  assert.deepEqual(pointProblems({ activity: 'Subgrade', inspection_test: 'Compaction', acceptance_criteria: '≥98%', frequency: '1/500 m²', responsible: 'LH', point_type: 'hold' }), []);
});
