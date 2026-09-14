import test from 'node:test';
import assert from 'node:assert/strict';
import { awstClock, eventClock, splitDay, hoursOnSite, type SignInRow } from './register.ts';

const row = (over: Partial<SignInRow>): SignInRow => ({
  id: 'x', person_name: 'Danny Rowe', company: null, person_kind: 'crew', inducted: true,
  signed_in_at: '2026-09-14T23:05:00Z', signed_in_on_device_at: '2026-09-14T23:05:00Z',
  signed_out_at: null, signed_out_on_device_at: null, ...over,
});

test('times print in Perth time, by hand', () => {
  assert.equal(awstClock('2026-09-14T23:05:00Z'), '07:05');
  assert.equal(awstClock(null), '—');
  assert.equal(awstClock('not a time'), '—');
});

test('the phone time is the event; the arrival is noted only when it disagrees', () => {
  assert.equal(eventClock('2026-09-14T23:05:00Z', '2026-09-14T23:06:10Z'), '07:06');
  assert.equal(eventClock('2026-09-14T23:05:00Z', '2026-09-15T01:00:00Z'), '07:05 (sent 09:00)');
});

test('the day splits into on site and left, each by arrival', () => {
  const rows = [
    row({ id: 'b', signed_in_on_device_at: '2026-09-14T23:30:00Z' }),
    row({ id: 'a', signed_in_on_device_at: '2026-09-14T23:00:00Z', signed_out_at: '2026-09-15T07:00:00Z', signed_out_on_device_at: '2026-09-15T07:00:00Z' }),
    row({ id: 'c', signed_in_on_device_at: '2026-09-14T23:10:00Z' }),
  ];
  const { onSite, left } = splitDay(rows);
  assert.deepEqual(onSite.map((r) => r.id), ['c', 'b']);
  assert.deepEqual(left.map((r) => r.id), ['a']);
});

test('hours on site round to the quarter hour and are null while still on site', () => {
  assert.equal(hoursOnSite(row({})), null);
  assert.equal(hoursOnSite(row({ signed_out_at: '2026-09-15T07:40:00Z', signed_out_on_device_at: '2026-09-15T07:40:00Z' })), 8.5);
});
