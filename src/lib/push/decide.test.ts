import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldRemind, dayOfWeek } from './decide.ts';

test('weekdays with no entry and no nudge yet get one', () => {
  assert.equal(
    shouldRemind({ perthToday: '2026-08-28', hasEntryToday: false, lastNotifiedOn: null }),
    true,
  ); // a Friday
});

test('weekends never nudge', () => {
  assert.equal(dayOfWeek('2026-08-29'), 6);
  assert.equal(dayOfWeek('2026-08-30'), 0);
  for (const day of ['2026-08-29', '2026-08-30']) {
    assert.equal(shouldRemind({ perthToday: day, hasEntryToday: false, lastNotifiedOn: null }), false);
  }
});

test('an entry already recorded today silences the nudge', () => {
  assert.equal(
    shouldRemind({ perthToday: '2026-08-28', hasEntryToday: true, lastNotifiedOn: null }),
    false,
  );
});

test('one nudge a day, whatever fires twice', () => {
  assert.equal(
    shouldRemind({ perthToday: '2026-08-28', hasEntryToday: false, lastNotifiedOn: '2026-08-28' }),
    false,
  );
  assert.equal(
    shouldRemind({ perthToday: '2026-08-28', hasEntryToday: false, lastNotifiedOn: '2026-08-27' }),
    true,
  );
});
