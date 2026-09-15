import test from 'node:test';
import assert from 'node:assert/strict';
import { gateDays, mergeGateIntoLabour, fromGate, gateQuoteCompany, GATE_PREFIX, type GateSignIn, type LabourItem } from './labour.ts';

const none: LabourItem[] = [];

const roles = new Map<string, string | null>([['marcus lee', 'Operator']]);
const marcusIn: GateSignIn = { person_name: 'Marcus Lee', company: null, person_kind: 'crew', signed_in_at: '2026-09-14T23:03:00Z', signed_in_on_device_at: '2026-09-14T23:02:00Z', signed_out_at: null, signed_out_on_device_at: null };
const marcusOut: GateSignIn = { ...marcusIn, signed_out_at: '2026-09-15T07:32:00Z', signed_out_on_device_at: '2026-09-15T07:31:00Z' };
const visitor: GateSignIn = { ...marcusIn, person_name: 'Courier', person_kind: 'delivery' };

test('a signed-in person becomes a labour row with the gate clock; the gate owns it', () => {
  const r = mergeGateIntoLabour(none, [marcusIn, visitor], roles);
  assert.equal(r.changed, true);
  assert.equal(r.items.length, 1, 'visitors and deliveries are not labour');
  const row = r.items[0];
  assert.equal(row.person_name, 'Marcus Lee');
  assert.equal(row.role, 'Operator');
  assert.equal(row.start_time, '07:02');
  assert.equal(row.finish_time, null);
  assert.equal(row.hours, null, 'still on site: hours are not invented');
  assert.ok(fromGate(row));
  assert.equal(row.source_quote, `${GATE_PREFIX} in 07:02 · still on site`);
});

test('signing out fills the finish and the hours on the gate’s row, keeping the supervisor’s break', () => {
  const first = mergeGateIntoLabour(none, [marcusIn], roles).items;
  const withBreak = [{ ...first[0], break_mins: 30 }];
  const r = mergeGateIntoLabour(withBreak, [marcusOut], roles);
  assert.equal(r.changed, true);
  assert.equal(r.items[0].finish_time, '15:31');
  assert.equal(r.items[0].hours, 7.98);
  assert.equal(r.items[0].break_mins, 30);
  assert.equal(r.items[0].source_quote, `${GATE_PREFIX} in 07:02 · out 15:31`);
  // Nothing new: the same array comes back and the autosave stays quiet.
  const again = mergeGateIntoLabour(r.items, [marcusOut], roles);
  assert.equal(again.changed, false);
  assert.equal(again.items, r.items);
});

test('a row the supervisor edited is theirs: the gate never overwrites a stated clock', () => {
  const theirs = [{ person_name: 'Marcus Lee', role: 'Operator', start_time: '06:30', finish_time: '16:30', break_mins: null, hours: 10, source_quote: 'From the gate, then edited by hand', confidence: null }];
  const r = mergeGateIntoLabour(theirs, [marcusOut], roles);
  assert.equal(r.changed, false);
  assert.equal(r.items[0].finish_time, '16:30');
});

test('a row heard in the recording with no times gets the gate’s clocks and hours, but is not marked as the gate’s', () => {
  const heard = [{ person_name: 'marcus lee', role: null, start_time: null, finish_time: null, break_mins: null, hours: null, source_quote: 'Marcus was on the vac truck', confidence: 'high' }];
  const r = mergeGateIntoLabour(heard, [marcusOut], roles);
  assert.equal(r.changed, true);
  assert.equal(r.items[0].start_time, '07:02');
  assert.equal(r.items[0].finish_time, '15:31');
  assert.equal(r.items[0].hours, 8.48);
  assert.equal(r.items[0].role, 'Operator');
  assert.equal(r.items[0].source_quote, 'Marcus was on the vac truck');
  assert.equal(fromGate(r.items[0]), false);
  // A stated hours figure with no times is left alone.
  const stated = [{ person_name: 'Marcus Lee', start_time: null, finish_time: null, hours: 8, source_quote: null }];
  const r2 = mergeGateIntoLabour(stated, [marcusOut], roles);
  assert.equal(r2.items[0].hours, 8);
  assert.equal(r2.items[0].finish_time, null);
  assert.equal(r2.items[0].start_time, '07:02');
});

test('two passes through the gate are one day: first in, last out, open if any pass is open', () => {
  const back: GateSignIn = { ...marcusIn, signed_in_on_device_at: '2026-09-15T04:00:00Z', signed_in_at: '2026-09-15T04:00:00Z', signed_out_on_device_at: '2026-09-15T09:00:00Z', signed_out_at: '2026-09-15T09:00:00Z' };
  const [d] = gateDays([marcusOut, back], roles);
  assert.equal(d.start, '07:02');
  assert.equal(d.finish, '17:00');
  const [open] = gateDays([marcusOut, { ...back, signed_out_at: null, signed_out_on_device_at: null }], roles);
  assert.equal(open.finish, null);
});

test('two people who share a name are two rows, kept apart by company, each following its own sign-out', () => {
  const abcIn: GateSignIn = { person_name: 'John Smith', company: 'ABC Civil', person_kind: 'subcontractor', signed_in_at: '2026-09-14T23:00:00Z', signed_in_on_device_at: '2026-09-14T23:00:00Z', signed_out_at: '2026-09-15T04:00:00Z', signed_out_on_device_at: '2026-09-15T04:00:00Z' };
  const xyzIn: GateSignIn = { ...abcIn, company: 'XYZ Plumbing', signed_in_at: '2026-09-15T05:00:00Z', signed_in_on_device_at: '2026-09-15T05:00:00Z', signed_out_at: null, signed_out_on_device_at: null };
  const r = mergeGateIntoLabour(none, [abcIn, xyzIn], new Map());
  assert.equal(r.items.length, 2);
  const abc = r.items.find((i) => gateQuoteCompany(i.source_quote) === 'abc civil')!;
  const xyz = r.items.find((i) => gateQuoteCompany(i.source_quote) === 'xyz plumbing')!;
  assert.deepEqual([abc.start_time, abc.finish_time, abc.hours], ['07:00', '12:00', 5]);
  assert.deepEqual([xyz.start_time, xyz.finish_time, xyz.hours], ['13:00', null, null]);
  assert.equal(abc.source_quote, `${GATE_PREFIX} ABC Civil · in 07:00 · out 12:00`);
  // XYZ's John signs out: only his row moves.
  const r2 = mergeGateIntoLabour(r.items, [abcIn, { ...xyzIn, signed_out_at: '2026-09-15T09:00:00Z', signed_out_on_device_at: '2026-09-15T09:00:00Z' }], new Map());
  assert.equal(r2.items.find((i) => gateQuoteCompany(i.source_quote) === 'xyz plumbing')!.finish_time, '17:00');
  assert.equal(r2.items.find((i) => gateQuoteCompany(i.source_quote) === 'abc civil')!.finish_time, '12:00');
});

test('when a typed name is ambiguous the gate leaves both rows alone rather than guess whose it is', () => {
  const typed = [
    { person_name: 'John Smith', role: 'ABC', start_time: null, finish_time: null, hours: null, source_quote: null },
    { person_name: 'John Smith', role: 'XYZ', start_time: null, finish_time: null, hours: null, source_quote: null },
  ];
  const one: GateSignIn = { person_name: 'John Smith', company: 'ABC', person_kind: 'subcontractor', signed_in_at: '2026-09-14T23:00:00Z', signed_in_on_device_at: '2026-09-14T23:00:00Z', signed_out_at: null, signed_out_on_device_at: null };
  const r = mergeGateIntoLabour(typed, [one], new Map());
  assert.equal(r.changed, false, 'neither typed row is touched, and no third John is invented');
  assert.equal(r.items.length, 2);
  assert.equal(r.items[0].start_time, null);
  assert.equal(r.items[1].start_time, null);
});

test('a gate row written before the company travelled in the quote is still that person’s row, not a duplicate', () => {
  const old = [{ person_name: 'John Smith', role: 'ABC Civil · signed in', start_time: '07:00', finish_time: null, break_mins: null, hours: null, source_quote: 'Gate: in 07:00 · still on site', confidence: null }];
  const abc: GateSignIn = { person_name: 'John Smith', company: 'ABC Civil', person_kind: 'subcontractor', signed_in_at: '2026-09-14T23:00:00Z', signed_in_on_device_at: '2026-09-14T23:00:00Z', signed_out_at: '2026-09-15T09:00:00Z', signed_out_on_device_at: '2026-09-15T09:00:00Z' };
  const r = mergeGateIntoLabour(old, [abc], new Map());
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].finish_time, '17:00');
  assert.equal(r.items[0].source_quote, `${GATE_PREFIX} ABC Civil · in 07:00 · out 17:00`);
});
