import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addYears, currentSds, sdsReviewDue, sdsStatus, registerFor, registerSummary, hazardLabel } from './model.ts';

const sheet = (o: Partial<Parameters<typeof sdsReviewDue>[0]> & { issued_on: string }) => ({
  id: o.id ?? 'a', issued_on: o.issued_on, version: o.version ?? null,
  file_path: 'file_path' in o ? o.file_path! : 'org/prod/a.pdf', active: o.active ?? true,
});

test('a sheet is current for five years from the date printed on it', () => {
  assert.equal(sdsReviewDue(sheet({ issued_on: '2024-03-01' })), '2029-03-01');
  assert.equal(sdsStatus([sheet({ issued_on: '2024-03-01' })], '2026-09-16'), 'current');
  assert.equal(sdsStatus([sheet({ issued_on: '2021-06-30' })], '2026-09-16'), 'out_of_date');
});

test('the register warns before a sheet stops being current, not after', () => {
  // Due 2026-11-01: inside the 90-day warning window on 16 September.
  assert.equal(sdsStatus([sheet({ issued_on: '2021-11-01' })], '2026-09-16'), 'due');
  // Due 2027-06-01: still plainly current.
  assert.equal(sdsStatus([sheet({ issued_on: '2022-06-01' })], '2026-09-16'), 'current');
});

test('a sheet recorded without a file is not accessible, so it is not current', () => {
  assert.equal(sdsStatus([sheet({ issued_on: '2025-01-10', file_path: null })], '2026-09-16'), 'no_file');
});

test('no sheet at all is its own answer, never a guess', () => {
  assert.equal(sdsStatus([], '2026-09-16'), 'none');
  assert.equal(currentSds([]), null);
});

test('the register holds the newest active sheet, and a retired one never wins', () => {
  const sheets = [
    sheet({ id: 'old', issued_on: '2019-01-01' }),
    sheet({ id: 'new', issued_on: '2025-02-02' }),
    sheet({ id: 'retired', issued_on: '2026-08-08', active: false }),
  ];
  assert.equal(currentSds(sheets)?.id, 'new');
  assert.equal(sdsStatus(sheets, '2026-09-16'), 'current');
});

test('29 February falls back to the 28th in a non-leap year', () => {
  assert.equal(addYears('2024-02-29', 5), '2029-02-28');
  assert.equal(addYears('2020-02-29', 4), '2024-02-29');
});

test('the register is sorted by name and summarised by what needs doing', () => {
  const lines = [
    { productId: 'b', name: 'Diesel', manufacturer: null, hazardClasses: ['flammable_liquid'], dgClass: '3', location: 'Compound', quantity: '1000 L', sheets: [sheet({ issued_on: '2025-01-01' })] },
    { productId: 'a', name: 'Acetylene', manufacturer: null, hazardClasses: [], dgClass: null, location: null, quantity: null, sheets: [] },
    { productId: 'c', name: 'Weedkiller', manufacturer: null, hazardClasses: [], dgClass: null, location: null, quantity: null, sheets: [sheet({ issued_on: '2018-01-01' })] },
  ];
  const verdicts = registerFor(lines, '2026-09-16');
  assert.deepEqual(verdicts.map((v) => v.name), ['Acetylene', 'Diesel', 'Weedkiller']);
  const summary = registerSummary(verdicts);
  assert.equal(summary.total, 3);
  assert.equal(summary.missing, 1);
  assert.equal(summary.outOfDate, 1);
  assert.equal(summary.attention, 2);
});

test('an unknown hazard class prints as itself rather than disappearing', () => {
  assert.equal(hazardLabel('flammable_liquid'), 'Flammable liquid');
  assert.equal(hazardLabel('something_new'), 'something_new');
});
