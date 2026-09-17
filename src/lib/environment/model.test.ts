import { test } from 'node:test';
import assert from 'node:assert/strict';
import { significance, evaluationProblems, envIncidentState, rainPrompts, monitoringOutcome, type EnvEvent } from './model.ts';

test('significance is likelihood x consequence at or over the threshold', () => {
  assert.deepEqual(significance(4, 3, 12), { score: 12, significant: true });
  assert.deepEqual(significance(2, 4, 12), { score: 8, significant: false });
  assert.deepEqual(significance(2, 4, null), { score: 8, significant: null });
});

test('an evaluation must cover the register in scope, evidence each result, and act on a gap', () => {
  const obligations = [
    { id: 'a', project_id: null, active: true },
    { id: 'b', project_id: 'p1', active: true },
    { id: 'c', project_id: 'p2', active: true },
    { id: 'd', project_id: null, active: false },
  ];
  assert.deepEqual(evaluationProblems(obligations, 'p1', [], null), ['2 obligations without a result', 'no summary of compliance status']);
  assert.equal(evaluationProblems(obligations, null, [], 'x')[0], '3 obligations without a result');
  assert.deepEqual(evaluationProblems(obligations, 'p1', [
    { legal_obligation_id: 'a', result: 'non_compliant', evidence: 'phoned only', action: null },
    { legal_obligation_id: 'b', result: 'not_applicable', evidence: null, action: null },
  ], 'One gap'), ['a non-compliance without an action']);
});

const ev = (kind: EnvEvent['kind'], at: string, extra: Partial<EnvEvent> = {}): EnvEvent =>
  ({ id: `${kind}${at}`, kind, happened_at: at, severity: null, serious: null, dwer_trigger: null, person_name: null, detail: null, ...extra });

test('the report clock follows the severity and the contract; nothing is due where the contract sets no clock', () => {
  const clocks = { seriousHours: 24, minorHours: 72, investigationDays: 28 };
  const occurred = '2026-09-17T01:00:00.000Z';
  const moderate = envIncidentState(occurred, [ev('assessed', '2026-09-17T02:00:00.000Z', { severity: 'moderate', serious: false })], clocks, '2026-09-18T03:00:00.000Z');
  assert.equal(moderate.reportDueAt, '2026-09-18T01:00:00.000Z');
  assert.equal(moderate.reportOverdue, true);
  const minor = envIncidentState(occurred, [ev('assessed', '2026-09-17T02:00:00.000Z', { severity: 'minor', serious: false })], clocks, '2026-09-18T03:00:00.000Z');
  assert.equal(minor.reportDueAt, '2026-09-20T01:00:00.000Z');
  assert.equal(minor.reportOverdue, false);
  const none = envIncidentState(occurred, [ev('assessed', '2026-09-17T02:00:00.000Z', { severity: 'major', serious: true })], { seriousHours: null, minorHours: null, investigationDays: null }, '2026-09-30T00:00:00.000Z');
  assert.equal(none.reportDueAt, null);
  assert.equal(none.investigationDueAt, null);
});

test('a Serious incident is investigated within the days from notifying the Superintendent', () => {
  const s = envIncidentState('2026-09-01T00:00:00.000Z', [
    ev('assessed', '2026-09-01T01:00:00.000Z', { severity: 'major', serious: true }),
    ev('superintendent_notified', '2026-09-01T02:00:00.000Z'),
    ev('report_given', '2026-09-01T20:00:00.000Z'),
  ], { seriousHours: 24, minorHours: 72, investigationDays: 28 }, '2026-09-30T00:00:00.000Z');
  assert.equal(s.investigationDueAt, '2026-09-29T02:00:00.000Z');
  assert.equal(s.investigationOverdue, true);
  assert.deepEqual(s.outstanding, ['Investigation report overdue']);
});

test('a phone call to Environment WAtch is not written notice', () => {
  const s = envIncidentState('2026-09-01T00:00:00.000Z', [
    ev('dwer_notifiable', '2026-09-01T01:00:00.000Z', { dwer_trigger: 'emergency_accident_malfunction' }),
    ev('dwer_phoned', '2026-09-01T01:10:00.000Z'),
  ], { seriousHours: null, minorHours: null, investigationDays: null }, '2026-09-01T05:00:00.000Z');
  assert.equal(s.dwerNotifiable, true);
  assert.equal(s.dwerWrittenAt, null);
  assert.match(s.outstanding[0], /phone call does not meet s\. 72/);
  const done = envIncidentState('2026-09-01T00:00:00.000Z', [
    ev('dwer_notifiable', '2026-09-01T01:00:00.000Z', { dwer_trigger: 'prescribed_waste' }),
    ev('dwer_written_notice', '2026-09-01T03:00:00.000Z'),
  ], { seriousHours: null, minorHours: null, investigationDays: null }, '2026-09-01T05:00:00.000Z');
  assert.ok(!done.outstanding.some((o) => /DWER/.test(o)));
});

test('heavy rain asks for an environmental check the next day, unless one was done', () => {
  const weather = [
    { day: '2026-09-10', rainfall_mm: 12.4 },
    { day: '2026-09-11', rainfall_mm: 3 },
    { day: '2026-09-14', rainfall_mm: 18 },
    { day: '2026-09-16', rainfall_mm: null },
    { day: '2026-08-20', rainfall_mm: 40 },
  ];
  assert.deepEqual(rainPrompts(weather, ['2026-09-11'], 10, '2026-09-17'), [{ day: '2026-09-14', rainfallMm: 18, dueOn: '2026-09-15' }]);
  assert.deepEqual(rainPrompts(weather, [], null, '2026-09-17'), []);
});

test('a reading over its limit is an exceedance whatever was ticked', () => {
  assert.equal(monitoringOutcome(72, 65, 'within_limit'), 'exceedance');
  assert.equal(monitoringOutcome(60, 65, 'exceedance'), 'within_limit');
  assert.equal(monitoringOutcome(null, null, 'observation'), 'observation');
});
