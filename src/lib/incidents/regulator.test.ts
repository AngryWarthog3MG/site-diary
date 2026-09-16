import { test } from 'node:test';
import assert from 'node:assert/strict';
import { regulatorState, perthDay, type RegulatorEvent } from './regulator.ts';

let n = 0;
const ev = (kind: RegulatorEvent['kind'], happened_at: string, extra: Partial<RegulatorEvent> = {}): RegulatorEvent =>
  ({ id: `e${n++}`, kind, happened_at, method: null, person_name: null, detail: null, ...extra });

test('an ordinary report with no notifiable flag and no events asks nothing of the regulator', () => {
  const s = regulatorState(false, [], '2026-09-16T02:00:00Z');
  assert.equal(s.applies, false);
  assert.deepEqual(s.outstanding, []);
});

test('a report flagged notifiable with nothing recorded says what has to happen, notification first in the list after awareness', () => {
  const s = regulatorState(true, [], '2026-09-16T02:00:00Z');
  assert.equal(s.applies, true);
  assert.ok(s.outstanding.some((o) => o.startsWith('Notify WorkSafe WA now')));
  assert.ok(s.outstanding.some((o) => o.includes('who holds that duty')));
});

test('becoming aware later is enough to make the duties apply, even if the report said otherwise', () => {
  const s = regulatorState(false, [ev('became_aware', '2026-09-16T01:00:00Z')], '2026-09-16T02:00:00Z');
  assert.equal(s.applies, true);
});

test('the time to notify is measured from becoming aware, in whole minutes', () => {
  const s = regulatorState(true, [
    ev('became_aware', '2026-09-16T01:00:00Z'),
    ev('notified', '2026-09-16T01:25:30Z', { method: 'phone' }),
  ], '2026-09-16T02:00:00Z');
  assert.equal(s.minutesToNotify, 26);
  assert.equal(s.notifiedMethod, 'phone');
});

test('written notice is due 48 hours after WorkSafe requires it, and overdue after that', () => {
  const events = [
    ev('became_aware', '2026-09-16T01:00:00Z'),
    ev('notified', '2026-09-16T01:10:00Z', { method: 'phone' }),
    ev('written_notice_required', '2026-09-16T03:00:00Z'),
  ];
  const before = regulatorState(true, events, '2026-09-18T02:59:00Z');
  assert.equal(before.writtenNoticeDueAt, '2026-09-18T03:00:00.000Z');
  assert.equal(before.writtenNoticeOverdue, false);
  const after = regulatorState(true, events, '2026-09-18T03:01:00Z');
  assert.equal(after.writtenNoticeOverdue, true);
  assert.ok(after.outstanding.includes('Written notice is overdue.'));
  const done = regulatorState(true, [...events, ev('written_notice_given', '2026-09-17T00:00:00Z')], '2026-09-20T00:00:00Z');
  assert.equal(done.writtenNoticeOverdue, false);
});

test('written notice given BEFORE a later requirement does not answer it', () => {
  const s = regulatorState(true, [
    ev('notified', '2026-09-16T01:10:00Z', { method: 'phone' }),
    ev('written_notice_given', '2026-09-16T02:00:00Z'),
    ev('written_notice_required', '2026-09-17T00:00:00Z'),
  ], '2026-09-20T00:00:00Z');
  assert.equal(s.writtenNoticeGivenAt, null);
  assert.equal(s.writtenNoticeOverdue, true);
});

test('the record is kept five years from the Perth day notice was given', () => {
  // 20:30 UTC on the 15th is 04:30 on the 16th in Perth.
  assert.equal(perthDay('2026-09-15T20:30:00Z'), '2026-09-16');
  const s = regulatorState(true, [ev('notified', '2026-09-15T20:30:00Z', { method: 'phone' })], '2026-09-16T02:00:00Z');
  assert.equal(s.keepUntil, '2031-09-16');
});

test('preservation names the duty-holder, and nothing is outstanding once every step is recorded', () => {
  const s = regulatorState(true, [
    ev('became_aware', '2026-09-16T01:00:00Z'),
    ev('notified', '2026-09-16T01:10:00Z', { method: 'phone' }),
    ev('site_preserved', '2026-09-16T01:05:00Z', { person_name: 'Georgiou Group (principal contractor)' }),
  ], '2026-09-16T02:00:00Z');
  assert.equal(s.dutyHolder, 'Georgiou Group (principal contractor)');
  assert.deepEqual(s.outstanding, []);
});
