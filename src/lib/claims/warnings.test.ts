import test from 'node:test';
import assert from 'node:assert/strict';
import { registerWarnings, registerWarningCount } from './warnings.ts';

const day = (date: string, hours: number | null) => ({ date, hours });
const item = (over: Partial<Parameters<typeof registerWarnings>[0]> = {}) => ({
  estimated_cost: 1200,
  agreed_cost: null,
  hours: 10,
  mentions: [day('2026-09-07', 10)],
  ...over,
});

test('a variation valued at nothing with work behind it is the whole point', () => {
  const w = registerWarnings(item({ estimated_cost: 0, hours: 84, mentions: [day('2026-09-07', 10), day('2026-09-08', 74)] }));
  assert.equal(w.length, 1);
  assert.equal(w[0].kind, 'priced_at_nothing');
  assert.match(w[0].text, /84 hours over 2 days/);
});

test('an agreed figure is the value, even when the estimate is zero', () => {
  assert.deepEqual(registerWarnings(item({ estimated_cost: 0, agreed_cost: 4500 })), []);
  // And an agreed zero with work behind it is still worth saying out loud.
  assert.equal(registerWarnings(item({ estimated_cost: 9000, agreed_cost: 0 }))[0].kind, 'priced_at_nothing');
});

test('no value at all is not this warning — the tracker already says "put a value on it"', () => {
  assert.deepEqual(registerWarnings(item({ estimated_cost: null, agreed_cost: null })), []);
});

test('nothing recorded against it may honestly be worth nothing', () => {
  assert.deepEqual(registerWarnings(item({ estimated_cost: 0, hours: 0, mentions: [] })), []);
});

test('days with no hours read the claim short, and are named', () => {
  const w = registerWarnings(item({ hours: 10, mentions: [day('2026-08-31', null), day('2026-09-01', null), day('2026-09-07', 10)] }));
  assert.equal(w.length, 1);
  assert.equal(w[0].kind, 'hours_not_recorded');
  assert.match(w[0].text, /2 of 3 days carry no hours: 31\/08, 01\/09/);
});

test('a variation can be wrong in both ways at once', () => {
  const w = registerWarnings(item({ estimated_cost: 0, hours: 0, mentions: [day('2026-08-31', null)] }));
  assert.deepEqual(w.map((x) => x.kind), ['priced_at_nothing', 'hours_not_recorded']);
  // With no hours stated anywhere, it counts days rather than inventing a figure.
  assert.match(w[0].text, /1 day recorded against it/);
});

test('the count is variations with something wrong, not warnings', () => {
  assert.equal(registerWarningCount([
    item({ estimated_cost: 0, mentions: [day('2026-09-07', null)] }), // both
    item(),                                                            // fine
    item({ agreed_cost: 0 }),                                          // one
  ]), 2);
});
