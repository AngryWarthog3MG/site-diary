import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildUpOpen, cardFor, lineAmount, lineProblems, matchLabourRate, matchPlantRate, orderLines, proposeFromDiary, summarise, type DiaryDay, type RateItem } from './costs.ts';
import { fmtMoney } from '../money.ts';

const rate = (over: Partial<RateItem>): RateItem => ({ id: 'r1', org_id: 'o', project_id: null, kind: 'labour', label: 'Labourer', plant_id: null, unit: 'hour', rate: 95, notes: null, active: true, ...over });

test('an amount is quantity x rate to the cent, and blank when either is blank', () => {
  assert.equal(lineAmount(8, 105), 840);
  assert.equal(lineAmount(4.5, 150), 675);
  assert.equal(lineAmount(12, 32.5), 390);
  assert.equal(lineAmount(0.35, 1.15), 0.4);
  assert.equal(lineAmount(null, 95), null);
  assert.equal(lineAmount(8, null), null);
});

test('the job card: the job rate replaces the company rate of the same name; retired rates are gone', () => {
  const card = cardFor([
    rate({ id: 'c-lab', label: 'Labourer', rate: 95 }),
    rate({ id: 'j-lab', project_id: 'p1', label: ' labourer ', rate: 105 }),
    rate({ id: 'c-sup', label: 'Supervisor', rate: 130 }),
    rate({ id: 'c-old', label: 'Old', active: false }),
    rate({ id: 'c-ex', kind: 'plant', label: 'Excavator 5t', rate: 150, plant_id: 'm1' }),
    rate({ id: 'other-job', project_id: 'p2', label: 'Labourer', rate: 120 }),
  ], 'p1');
  assert.deepEqual(card.map((r) => [r.id, r.scope]), [['j-lab', 'job'], ['c-sup', 'company'], ['c-ex', 'company']]);
  assert.equal(matchLabourRate('LABOURER', card)?.rate, 105);
  assert.equal(matchLabourRate('Machine Op', card), null);
  assert.equal(matchLabourRate(null, card), null);
  assert.equal(matchPlantRate({ id: 'm1', name: 'EX-02' }, card)?.id, 'c-ex');
  assert.equal(matchPlantRate({ id: 'm9', name: 'excavator 5t' }, card)?.id, 'c-ex');
});

test('the summary adds what is priced and counts what is not', () => {
  const s = summarise([
    { kind: 'labour', quantity: 8, rate: 105, amount: 840 },
    { kind: 'plant', quantity: 4.5, rate: 150, amount: 675 },
    { kind: 'material', quantity: 12, rate: null, amount: null },
    { kind: 'labour', quantity: null, rate: 95, amount: null },
  ]);
  assert.equal(s.total, 1515);
  assert.deepEqual(s.byKind, { labour: 840, plant: 675, material: 0, other: 0 });
  assert.equal(s.unpriced, 1);
  assert.equal(s.noQuantity, 1);
  assert.equal(s.countByKind.labour, 2);
  assert.deepEqual(lineProblems({ description: 'Road base', quantity: 12, rate: null, kind: 'material', person_name: null }), ['a rate']);
  assert.deepEqual(lineProblems({ description: 'Labourer', quantity: null, rate: 95, kind: 'labour', person_name: 'Sam' }), ['the hours']);
});

test('from the diary: a line per person per signed day, the role says the rate, nothing twice, nothing invented', () => {
  const card = cardFor([rate({ id: 'lab', label: 'Labourer', rate: 95 }), rate({ id: 'sup', label: 'Supervisor', rate: 130 })], 'p1');
  const days: DiaryDay[] = [
    { variationId: 'v1', entryId: 'e1', date: '2026-09-16', signed: true, hours: 6, crew: ['Sam Test', 'Matthew Rodgers'], roles: { 'sam test': 'Labourer', 'matthew rodgers': 'Supervisor' } },
    { variationId: 'v2', entryId: 'e2', date: '2026-09-17', signed: true, hours: null, crew: ['Evan Burke'], roles: { 'evan burke': 'Machine Op' } },
    { variationId: 'v3', entryId: 'e3', date: '2026-09-18', signed: true, hours: 4, crew: [], roles: {} },
    { variationId: 'v4', entryId: 'e4', date: '2026-09-19', signed: false, hours: 8, crew: ['Sam Test'], roles: { 'sam test': 'Labourer' } },
  ];
  const lines = proposeFromDiary(days, [{ kind: 'labour', source_variation_id: 'v1', person_name: 'sam test' }], card);
  assert.deepEqual(lines.map((l) => [l.work_date, l.person_name, l.description, l.quantity, l.rate]), [
    ['2026-09-16', 'Matthew Rodgers', 'Supervisor', 6, 130],
    ['2026-09-17', 'Evan Burke', 'Machine Op', null, null],
    ['2026-09-18', null, 'Labour — crew not named', 4, null],
  ]);
  assert.equal(lines[0].rate_item_id, 'sup');
  assert.equal(lines[1].rate_item_id, null);
});

test('a day whose hours look like the total between several people comes in with no hours, and says why', () => {
  const card = cardFor([rate({ id: 'lab', label: 'Labourer', rate: 95 })], 'p1');
  const days: DiaryDay[] = [
    { variationId: 'v1', entryId: 'e1', date: '2026-09-10', signed: true, hours: 20, crew: ['Marcus Hayden', 'Hamish Hayden'], roles: { 'marcus hayden': 'Labourer', 'hamish hayden': 'Labourer' } },
    { variationId: 'v2', entryId: 'e2', date: '2026-09-11', signed: true, hours: 14, crew: ['Solo Worker'], roles: { 'solo worker': 'Labourer' } },
    { variationId: 'v3', entryId: 'e3', date: '2026-09-12', signed: true, hours: 12, crew: ['Marcus Hayden', 'Hamish Hayden'], roles: {} },
  ];
  const lines = proposeFromDiary(days, [], card);
  assert.deepEqual(lines.map((l) => [l.work_date, l.person_name, l.quantity]), [
    ['2026-09-10', 'Marcus Hayden', null], ['2026-09-10', 'Hamish Hayden', null],
    ['2026-09-11', 'Solo Worker', 14],
    ['2026-09-12', 'Marcus Hayden', 12], ['2026-09-12', 'Hamish Hayden', 12],
  ]);
  assert.match(lines[0].note ?? '', /20 h with 2 named — each, or between them\? Enter Marcus Hayden's hours/);
  assert.equal(lines[2].note, null);
});

test('one day, two rows of the same variation: both come in, and an unnamed row quotes the diary', () => {
  const days: DiaryDay[] = [
    { variationId: 'r1', entryId: 'e17', date: '2026-09-17', signed: true, hours: 10, crew: [], roles: {}, description: 'Marcus, Hamish on vac trailer widening trench' },
    { variationId: 'r2', entryId: 'e17', date: '2026-09-17', signed: true, hours: 6, crew: [], roles: {}, description: 'Matt and Evan widening irrigation trench' },
  ];
  const lines = proposeFromDiary(days, [], []);
  assert.deepEqual(lines.map((l) => [l.source_variation_id, l.quantity]), [['r1', 10], ['r2', 6]]);
  assert.match(lines[0].note ?? '', /one person's hours\. Diary: “Marcus, Hamish on vac trailer/);
  assert.equal(proposeFromDiary(days, [{ kind: 'labour', source_variation_id: 'r1', person_name: null }], []).length, 1);
});

test('open while raised or priced; lines read by kind then day', () => {
  assert.equal(buildUpOpen('raised'), true);
  assert.equal(buildUpOpen('priced'), true);
  assert.equal(buildUpOpen('submitted'), false);
  assert.equal(buildUpOpen('paid'), false);
  const o = orderLines([
    { kind: 'plant', work_date: '2026-09-16', person_name: null, description: 'Excavator' },
    { kind: 'labour', work_date: '2026-09-17', person_name: 'Ann', description: 'Labourer' },
    { kind: 'labour', work_date: '2026-09-16', person_name: 'Zed', description: 'Labourer' },
  ]);
  assert.deepEqual(o.map((l) => l.person_name ?? l.description), ['Zed', 'Ann', 'Excavator']);
});

test('money prints whole dollars, cents when it has them, a dash for nothing', () => {
  assert.equal(fmtMoney(1905), '$1,905');
  assert.equal(fmtMoney(390.5), '$390.50');
  assert.equal(fmtMoney(null), '—');
  assert.equal(fmtMoney(0), '$0');
});
