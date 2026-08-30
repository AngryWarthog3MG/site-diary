import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatInstant, num, sortRows, text, timeOnly } from './load.ts';

/**
 * The byte-identical guarantee (§2.3) rests on these. `npm run pdf:check`
 * proves two renders match; these say *why* they match, and fail loudly if
 * someone reaches for a locale formatter or an id-based sort later.
 */

test('a stored instant prints as an unambiguous UTC time', () => {
  assert.equal(formatInstant('2026-08-25T09:31:04.000+00:00'), '2026-08-25 09:31:04 UTC');
  assert.equal(formatInstant('2026-08-25T09:31:04Z'), '2026-08-25 09:31:04 UTC');
});

test('an offset is resolved rather than printed as local time', () => {
  // 17:31 in Perth is 09:31 UTC. The docket must not claim two different times
  // for the same moment depending on where it was rendered.
  assert.equal(formatInstant('2026-08-25T17:31:04+08:00'), '2026-08-25 09:31:04 UTC');
  assert.equal(formatInstant('2026-08-25T04:31:04-05:00'), '2026-08-25 09:31:04 UTC');
});

test('the same instant prints identically however it was written down', () => {
  const forms = [
    '2026-08-25T09:31:04.000+00:00',
    '2026-08-25T09:31:04Z',
    '2026-08-25T19:31:04+10:00',
    '2026-08-25T02:31:04-07:00',
  ];
  const printed = new Set(forms.map(formatInstant));
  assert.equal(printed.size, 1, `got ${[...printed].join(' / ')}`);
});

test('a missing or unreadable timestamp does not invent one', () => {
  assert.equal(formatInstant(null), '—');
  assert.equal(formatInstant('not a date'), 'not a date');
});

test('formatting does not depend on the machine’s timezone', () => {
  const original = process.env.TZ;
  const seen = new Set<string>();
  for (const tz of ['UTC', 'Australia/Perth', 'America/New_York', 'Pacific/Kiritimati']) {
    process.env.TZ = tz;
    seen.add(formatInstant('2026-08-25T09:31:04+00:00'));
  }
  process.env.TZ = original;
  assert.equal(seen.size, 1, `timezone changed the output: ${[...seen].join(' / ')}`);
});

test('numbers print at a fixed scale, so one value never renders two ways', () => {
  assert.equal(num(18.5), '18.50');
  assert.equal(num(18.5, 3), '18.500');
  assert.equal(num('9'), '9.00');
  assert.equal(num(0), '0.00');
});

test('an absent number is a dash, not a zero', () => {
  assert.equal(num(null), '—');
  assert.equal(num(undefined), '—');
  assert.equal(num(''), '—');
  assert.equal(text(null), '—');
  assert.equal(text('   '), '—');
  assert.equal(timeOnly(null), '—');
});

test('a stored time prints without seconds', () => {
  assert.equal(timeOnly('09:30:00'), '09:30');
  assert.equal(timeOnly('09:30'), '09:30');
});

// --- ordering --------------------------------------------------------------

const rows = [
  { id: 'z', entry_id: 'e', created_at: 't1', person_name: 'Sam Whitely', hours: 9 },
  { id: 'a', entry_id: 'e', created_at: 't2', person_name: 'Danny Rowe', hours: 9 },
  { id: 'm', entry_id: 'e', created_at: 't3', person_name: 'Kel Brady', hours: 8 },
];

test('rows are ordered by content, so the same record always prints the same way', () => {
  const a = sortRows(rows).map((r) => r.person_name);
  const b = sortRows([...rows].reverse()).map((r) => r.person_name);
  assert.deepEqual(a, b);
});

test('ordering ignores ids and timestamps — they are storage, not the record', () => {
  // The same three people, restored into a new database with new row ids and
  // new created_at values, must still print in the same order.
  const restored = rows.map((row, index) => ({
    ...row,
    id: `restored-${index}`,
    created_at: `2027-01-0${index + 1}`,
  }));

  assert.deepEqual(
    sortRows(rows).map((r) => r.person_name),
    sortRows(restored).map((r) => r.person_name),
  );
});

test('sorting does not mutate the caller’s array', () => {
  const input = [...rows];
  sortRows(input);
  assert.deepEqual(input.map((r) => r.id), rows.map((r) => r.id));
});
