import test from 'node:test';
import assert from 'node:assert/strict';
import { approvalOf, declarationText, driftFrom, driftText, itemRanges, lineKey, signaturePath, signoffFor, signoffPath, snapshotLines, type DayworkSignoff } from './signoff.ts';

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

const line = (date: string, works: string, hours: number | null) => ({ date, works, hours });

test('a daywork is approved when a sign-off holds its line; a changed line waits again (README R125)', () => {
  const lines = [line('2026-09-28', 'Expose the main line', 8), line('2026-09-29', 'Lay footpath', 6.5), line('2026-09-30', 'Mulch PG1', null)];
  const monday = s({ id: 'm', signed_on: '2026-09-30', lines: snapshotLines(lines.slice(0, 2)), items: 2, hours: 14.5 });
  const a = approvalOf(lines, [monday]);
  assert.deepEqual(a.by.map((x) => x?.id ?? null), ['m', 'm', null]);
  assert.deepEqual([a.approved, a.approvedHours, a.awaiting, a.awaitingHours, a.awaitingNoHours, a.state], [2, 14.5, 1, 0, 1, 'part']);
  // The hours on the first line are corrected afterwards: it is no longer what was signed for.
  const corrected = [line('2026-09-28', 'Expose the main line', 10), lines[1], lines[2]];
  const b = approvalOf(corrected, [monday]);
  assert.deepEqual(b.by.map((x) => x?.id ?? null), [null, 'm', null]);
  assert.equal(b.awaitingHours, 10);
  // Spacing and case in the works are not a change.
  assert.equal(lineKey(line('2026-09-28', '  expose the  MAIN line ', 8)), lineKey(lines[0]));
});

test('everything signed is approved; nothing to sign is nothing; a sign-off without lines approves nothing here', () => {
  const lines = [line('2026-09-28', 'A', 4), line('2026-09-28', 'B', 4)];
  assert.equal(approvalOf(lines, [s({ lines: snapshotLines(lines), items: 2, hours: 8 })]).state, 'approved');
  assert.equal(approvalOf([], [s({ lines: snapshotLines(lines) })]).state, 'nothing');
  assert.equal(approvalOf(lines, [s({ lines: null })]).state, 'awaiting');
  assert.equal(approvalOf(lines, []).awaitingHours, 8);
});

test('two identical lines need two signatures\' worth, and the earliest signature is the approval', () => {
  const twice = [line('2026-09-28', 'Water plants', 2), line('2026-09-28', 'Water plants', 2)];
  const one = s({ id: 'one', signed_on: '2026-09-29', lines: snapshotLines(twice.slice(0, 1)), items: 1, hours: 2 });
  assert.deepEqual(approvalOf(twice, [one]).by.map((x) => x?.id ?? null), ['one', null]);
  const later = s({ id: 'later', signed_on: '2026-10-02', lines: snapshotLines(twice), items: 2, hours: 4 });
  assert.deepEqual(approvalOf(twice, [later, one]).by.map((x) => x?.id ?? null), ['one', 'later']);
});

test('the words signed under, the item numbers as read, and where a drawn signature is filed', () => {
  assert.match(declarationText('Lendlease', 3), /^For signature by Lendlease\. The 3 items of work listed were carried out/);
  assert.match(declarationText('Lendlease', 1), /The 1 item of work listed was carried out .* recorded against it\./);
  assert.match(declarationText(' ', 2), /by the head contractor/);
  assert.match(declarationText('Lendlease', 2), /Rates, entitlement and value are dealt with under the contract\.$/);
  assert.equal(itemRanges([1, 2, 3, 4, 5, 6, 8, 10, 11]), '1–6, 8, 10, 11');
  assert.equal(itemRanges([3]), '3');
  assert.equal(itemRanges([]), '');
  assert.equal(signaturePath('proj', 'sig'), 'proj/sig.png');
});
