import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draftFromEvent, draftGaps, eventInstant, hoursSince, noticeRef, sinceText } from './model.ts';

const ev = (over: Partial<Parameters<typeof draftFromEvent>[0]> = {}) => ({
  said_text: 'Lendlease told us to hold the west kerb till the pegs are re-set',
  location: null, directed_by: null, occurred_time: null, entry_date: '2026-09-18', ...over,
});

test('the clock starts when the supervisor said it happened, else at knock-off', () => {
  assert.equal(eventInstant(ev({ occurred_time: '10:15:00' })), '2026-09-18T10:15:00+08:00');
  assert.equal(eventInstant(ev()), '2026-09-18T17:00:00+08:00');
  assert.equal(hoursSince(ev({ occurred_time: '10:15:00' }), '2026-09-19T10:14:00+08:00'), 23);
  assert.equal(hoursSince(ev({ occurred_time: '10:15:00' }), '2026-09-19T10:15:00+08:00'), 24);
  // Never negative, and never a guess on bad input.
  assert.equal(hoursSince(ev({ occurred_time: '10:15:00' }), '2026-09-18T09:00:00+08:00'), 0);
  assert.equal(hoursSince(ev(), 'nonsense'), 0);
});

test('since reads in hours, then days', () => {
  assert.equal(sinceText(0), 'under an hour ago');
  assert.equal(sinceText(1), '1 hour ago');
  assert.equal(sinceText(47), '47 hours ago');
  assert.equal(sinceText(48), '2 days ago');
  assert.equal(sinceText(200), '8 days ago');
});

test('the draft carries the words verbatim and invents nothing else', () => {
  const d = draftFromEvent(ev({ occurred_time: '10:15:00', location: 'Chainage 4200', directed_by: 'Dave Keane' }));
  assert.ok(d.what_happened.startsWith('Lendlease told us to hold the west kerb till the pegs are re-set'));
  assert.match(d.what_happened, /site diary, 18\/09\/2026 at 10:15 at Chainage 4200\. Directed by Dave Keane\./);
  assert.equal(d.why_outside_scope, '');
  assert.equal(d.work_affected, '');
  assert.equal(d.what_we_need, '');
  assert.match(d.evidence, /18\/09\/2026, signed/);
  // Nothing said, nothing written.
  assert.match(draftFromEvent(ev()).what_happened, /site diary, 18\/09\/2026\.$/);
});

test('what is still to write is advice, and names the parts', () => {
  assert.deepEqual(draftGaps(draftFromEvent(ev())), ['why it is outside our scope', 'the work affected', 'what we need']);
  assert.deepEqual(draftGaps({ what_happened: 'x', why_outside_scope: 'y', work_affected: 'z', what_we_need: 'w', evidence: '' }), []);
});

test('a notice is numbered per job', () => {
  assert.equal(noticeRef(7), 'N-007');
  assert.equal(noticeRef(120), 'N-120');
});
