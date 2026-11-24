import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayBlockers, dayLines, dayPeriodLabel, dayworkHours } from './day-approval.ts';
import { approvalOf, lineKey, type DayworkSignoff } from './signoff.ts';

const DAY = '2026-11-25';
const signoff = (lines: DayworkSignoff['lines'], over: Partial<DayworkSignoff> = {}): DayworkSignoff => ({
  id: 's1', period_from: DAY, period_to: DAY, period_label: dayPeriodLabel(DAY), items: lines?.length ?? 0, hours: 0, hours_not_recorded: 0, photos: 0,
  signed_by_name: 'Example Signer', signed_by_position: 'Site manager', signed_on: DAY, file_path: null, note: null, signed_how: 'on_screen', lines, ...over,
});

test('the hours are the ones the database keeps: the people added up, else the figure typed', () => {
  assert.equal(dayworkHours({ hours: 6 }), 6);
  assert.equal(dayworkHours({ hours: '4.5' }), 4.5);
  assert.equal(dayworkHours({ hours: 6, labour_rows: [{ person_name: 'A', hours: 3.5 }, { person_name: 'B', hours: 4 }] }), 7.5);
  // One person without hours: the typed figure stands, exactly as apply_entry_review leaves it.
  assert.equal(dayworkHours({ hours: 6, labour_rows: [{ person_name: 'A', hours: 3.5 }, { person_name: 'B', hours: null }] }), 6);
  assert.equal(dayworkHours({ hours: '', labour_rows: [] }), null);
  assert.equal(dayworkHours({}), null);
});

test('the day reads as the schedule will read it once saved', () => {
  const lines = dayLines(DAY, [
    { description: '  Remove and relay kerb at Bus Port ', hours: 5, labour_rows: [{ person_name: 'Sam', hours: 4 }, { person_name: 'Jo', hours: 4 }], plant: ' 5t excavator ', materials: '', docket_ref: null },
    { description: 'Hand dig around services', hours: '2.5', labour: 'two labourers', labour_rows: null },
    { description: '   ', hours: 3 },
  ]);
  assert.deepEqual(lines, [
    { date: DAY, works: 'Remove and relay kerb at Bus Port', hours: 8, docket: null, labour: 'Sam 4 h, Jo 4 h', plant: '5t excavator', materials: null },
    { date: DAY, works: 'Hand dig around services', hours: 2.5, docket: null, labour: 'two labourers', plant: null, materials: null },
  ]);
  // The saved row the schedule loads: same day, same words, the summed hours — the same line.
  assert.equal(lineKey(lines[0]), lineKey({ date: DAY, works: 'Remove and relay kerb at Bus Port', hours: 8 }));
});

test('a signature on the diary approves the line; a line changed afterwards waits again', () => {
  const items = [{ description: 'Remove and relay kerb', hours: 6 }, { description: 'Hand dig around services', hours: 2.5 }];
  const signed = signoff(dayLines(DAY, items));
  assert.equal(approvalOf(dayLines(DAY, items), [signed]).state, 'approved');
  const changed = [{ description: 'Remove and relay kerb', hours: 7 }, items[1]];
  const a = approvalOf(dayLines(DAY, changed), [signed]);
  assert.equal(a.state, 'part');
  assert.deepEqual(a.by.map((s) => s?.id ?? null), [null, 's1']);
  // An item added after they signed waits on its own.
  const more = approvalOf(dayLines(DAY, [...items, { description: 'Traffic control', hours: 4 }]), [signed]);
  assert.deepEqual([more.approved, more.awaiting, more.awaitingHours], [2, 1, 4]);
});

test('filled in means every item says what was done and for how long', () => {
  assert.deepEqual(dayBlockers([{ description: 'Kerb', hours: 6 }]), []);
  assert.deepEqual(dayBlockers([{ description: 'Kerb', labour_rows: [{ person_name: 'Sam', hours: 4 }] }]), []);
  assert.deepEqual(dayBlockers([
    { description: '', hours: 2 },
    { description: 'Kerb' },
    { description: 'Dig', hours: 5, labour_rows: [{ person_name: 'Sam', hours: 4 }, { person_name: 'Jo', hours: null }] },
  ]), ['Item 1 has no description.', 'Item 2 has no hours.', 'Item 3: Jo has no hours.']);
  assert.deepEqual(dayBlockers([]), []);
});

test('the sign-off says it was given on the day', () => {
  assert.equal(dayPeriodLabel(DAY), "25/11/2026 — signed on the day's diary");
});
