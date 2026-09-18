import test from 'node:test';
import assert from 'node:assert/strict';
import { driftFrom, driftText, signoffFor, signoffPath, type DayworkSignoff } from './signoff.ts';

const s = (over: Partial<DayworkSignoff> = {}): DayworkSignoff => ({
  id: 'a', period_from: null, period_to: null, period_label: 'Whole job',
  items: 12, hours: 101, hours_not_recorded: 0, photos: 23,
  signed_by_name: 'Dave Keane', signed_by_position: 'Site Manager', signed_on: '2026-09-18',
  file_path: 'p/a.pdf', note: null, ...over,
});

test('a sign-off is found by the period it covered, not by dates that merely overlap', () => {
  const list = [s({ id: 'whole' }), s({ id: 'sept', period_from: '2026-09-01', period_to: '2026-09-30' })];
  assert.equal(signoffFor(list, { from: null, to: null })?.id, 'whole');
  assert.equal(signoffFor(list, { from: '2026-09-01', to: '2026-09-30' })?.id, 'sept');
  assert.equal(signoffFor(list, { from: '2026-09-01', to: '2026-09-15' }), null);
});

test('the same period signed twice takes the later signature', () => {
  const list = [s({ id: 'first', signed_on: '2026-09-10' }), s({ id: 'second', signed_on: '2026-09-18' })];
  assert.equal(signoffFor(list, { from: null, to: null })?.id, 'second');
});

test('no drift when the schedule still reads the way the client saw it', () => {
  assert.equal(driftFrom(s(), { items: 12, hours: 101 }), null);
});

test('a correction landing after the signature is the case this exists for', () => {
  const d = driftFrom(s(), { items: 13, hours: 111 });
  assert.deepEqual(d, { items: 1, hours: 10 });
  assert.equal(driftText(d!), '1 item and 10 hours more than when it was signed');
});

test('work taken off the schedule reads as fewer, not as a negative', () => {
  const d = driftFrom(s(), { items: 11, hours: 91 })!;
  assert.deepEqual(d, { items: -1, hours: -10 });
  assert.equal(driftText(d), '1 item and 10 hours fewer than when it was signed');
});

test('hours alone can drift', () => {
  assert.equal(driftText(driftFrom(s(), { items: 12, hours: 108.5 })!), '7.5 hours more than when it was signed');
});

test('the file is named for its sign-off, and a hostile extension cannot escape', () => {
  assert.equal(signoffPath('proj', 'sign', 'scan.PDF'), 'proj/sign.pdf');
  assert.equal(signoffPath('proj', 'sign', 'photo.jpeg'), 'proj/sign.jpeg');
  assert.equal(signoffPath('proj', 'sign', 'nodot'), 'proj/sign.nodot');
  assert.equal(signoffPath('proj', 'sign', 'a.../..'), 'proj/sign.pdf');
});
