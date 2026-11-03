import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  nextDue, dueAtHours, latestMeter, lastDone, lastDoneMeter, profileState, assetVerdict, summarise, sortVerdicts, assetMatches,
  custodySays, categoryLabel, presetsFor, describeProfile, hoursStatus, dateStatus,
  type AssetRow, type ProfileRow, type DoneFacts, type MeterFacts, type CheckoutFacts,
} from './model.ts';

const asset = (over: Partial<AssetRow> = {}): AssetRow => ({
  id: 'a1', org_id: 'o', plant_id: null, asset_class: 'electrical', name: '15 m extension lead', asset_no: 'EL-07', barcode: null, category: 'Lead',
  make_model: null, serial_no: null, ownership: 'own', supplier: null, hire_ref: null, location: 'Ute 2', purchased_on: null, notes: null, active: true, retired_reason: null, ...over,
});
const profile = (over: Partial<ProfileRow> = {}): ProfileRow => ({
  id: 'p1', asset_id: 'a1', kind: 'test', label: 'Test and tag', basis: null, every: 3, unit: 'month', first_due_on: '2026-01-15',
  every_hours: null, start_hours: null, assigned_to: null, priority: 'normal', active: true, notes: null, ...over,
});

test('nextDue: the first due until one is done, then an interval from the doing; the inspector\'s date wins; retired is null', () => {
  const p = profile();
  assert.equal(nextDue(p, null), '2026-01-15');
  assert.equal(nextDue(p, { done_on: '2026-01-20', next_due_on: null }), '2026-04-20');
  assert.equal(nextDue(p, { done_on: '2026-01-31', next_due_on: null }), '2026-04-30');
  assert.equal(nextDue(p, { done_on: '2026-01-20', next_due_on: '2026-03-01' }), '2026-03-01');
  assert.equal(nextDue(profile({ active: false }), null), null);
  assert.equal(nextDue(profile({ every: null, unit: null, first_due_on: null, every_hours: 250, start_hours: 1000 }), null), null);
});

test('dueAtHours: the cycle starts where the office said, then from the last doing\'s reading', () => {
  const p = profile({ every: null, unit: null, first_due_on: null, every_hours: 250, start_hours: 1000 });
  assert.equal(dueAtHours(p, null), 1250);
  assert.equal(dueAtHours(p, 1240), 1490);
  assert.equal(dueAtHours(profile(), 1240), null);
});

test('latestMeter: the latest day wins, then the higher reading on one day', () => {
  const r: MeterFacts[] = [
    { reading: 1200, read_on: '2026-02-01', source: 'prestart' },
    { reading: 1190, read_on: '2026-02-03', source: 'reading' },
    { reading: 1195, read_on: '2026-02-03', source: 'service' },
  ];
  assert.deepEqual(latestMeter(r), { reading: 1195, read_on: '2026-02-03', source: 'service' });
  assert.equal(latestMeter([]), null);
});

test('lastDone and lastDoneMeter read the latest record naming the profile, ignoring other profiles', () => {
  const done: DoneFacts[] = [
    { profile_id: 'p1', done_on: '2026-01-20', next_due_on: null, meter: null },
    { profile_id: 'p1', done_on: '2026-03-02', next_due_on: null, meter: 1100 },
    { profile_id: 'p2', done_on: '2026-05-01', next_due_on: null, meter: 9000 },
    { profile_id: null, done_on: '2026-06-01', next_due_on: null, meter: null },
  ];
  assert.equal(lastDone('p1', done)?.done_on, '2026-03-02');
  assert.equal(lastDoneMeter('p1', done), 1100);
  assert.equal(lastDone('p9', done), null);
});

test('statuses: overdue, due within thirty days, upcoming; a meter profile within a tenth of its interval is due soon', () => {
  assert.equal(dateStatus('2026-03-01', '2026-03-02'), 'overdue');
  assert.equal(dateStatus('2026-03-20', '2026-03-02'), 'due_soon');
  assert.equal(dateStatus('2026-06-01', '2026-03-02'), 'upcoming');
  assert.equal(dateStatus(null, '2026-03-02'), 'none');
  assert.equal(hoursStatus(1250, 250, 1251), 'overdue');
  assert.equal(hoursStatus(1250, 250, 1230), 'due_soon');
  assert.equal(hoursStatus(1250, 250, 1100), 'upcoming');
  assert.equal(hoursStatus(1250, 250, null), 'upcoming');
  // A 1,000-hour interval is capped at 25 hours' warning, not 100.
  assert.equal(hoursStatus(2000, 1000, 1920), 'upcoming');
  assert.equal(hoursStatus(2000, 1000, 1976), 'due_soon');
});

test('profileState: both clocks on one profile, the worse verdict wins, and the line says both', () => {
  const p = profile({ every: 6, unit: 'month', first_due_on: '2026-07-01', every_hours: 250, start_hours: 1000 });
  const s = profileState(p, [], [{ reading: 1260, read_on: '2026-03-01', source: 'prestart' }], '2026-03-02');
  assert.equal(s.status, 'overdue');
  assert.equal(s.due, '2026-07-01');
  assert.equal(s.dueAt, 1250);
  assert.match(s.says, /Due 01\/07\/2026/);
  assert.match(s.says, /Due at 1,250 h · read 1,260 h on 01\/03\/2026/);
  const retired = profileState(profile({ active: false }), [], [], '2026-03-02');
  assert.equal(retired.status, 'none');
  assert.equal(retired.says, 'Retired');
});

test('assetVerdict and summarise: the worst profile on the asset, custody, counts', () => {
  const a1 = asset();
  const a2 = asset({ id: 'a2', name: '9 kg extinguisher', asset_class: 'fire', asset_no: 'FE-01', ownership: 'hired' });
  const a3 = asset({ id: 'a3', name: 'Old drill', active: false, retired_reason: 'Scrapped' });
  const profiles: ProfileRow[] = [
    profile({ id: 'p1', asset_id: 'a1', first_due_on: '2026-02-01' }),
    profile({ id: 'p2', asset_id: 'a1', label: 'RCD test', first_due_on: '2026-09-01' }),
    profile({ id: 'p3', asset_id: 'a2', label: '6-monthly service', first_due_on: '2026-03-20' }),
  ];
  const checkouts: CheckoutFacts[] = [{ id: 'c1', asset_id: 'a2', holder_name: 'Sam', project_code: 'C010', out_at: '2026-03-01T01:00:00Z', due_back_on: '2026-02-28', in_at: null }];
  const today = '2026-03-02';
  const v1 = assetVerdict(a1, profiles, [], [], checkouts, today);
  assert.equal(v1.status, 'overdue');
  assert.equal(v1.next?.profile.id, 'p1');
  assert.equal(v1.custody, null);
  const v2 = assetVerdict(a2, profiles, [], [], checkouts, today);
  assert.equal(v2.status, 'due_soon');
  assert.equal(custodySays(v2.custody, today).tone, 'bad');
  assert.equal(custodySays(v2.custody, today).text, 'With Sam on C010 · back 28/02/2026');
  const v3 = assetVerdict(a3, profiles, [], [], checkouts, today);
  const s = summarise([v1, v2, v3]);
  assert.deepEqual(s, { inService: 2, retired: 1, overdue: 1, dueSoon: 1, out: 1, hired: 1, noProfile: 0 });
  const order = sortVerdicts([v3, v2, v1]).map((v) => v.asset.id);
  assert.deepEqual(order, ['a1', 'a2', 'a3']);
});

test('assetMatches: every word somewhere on the asset, and the class chip', () => {
  const v = assetVerdict(asset(), [], [], [], [{ id: 'c', asset_id: 'a1', holder_name: 'Sam Labourer', project_code: 'C010', out_at: '', due_back_on: null, in_at: null }], '2026-03-02');
  assert.equal(assetMatches(v, 'lead ute', null), true);
  assert.equal(assetMatches(v, 'sam c010', null), true);
  assert.equal(assetMatches(v, 'EL-07', 'electrical'), true);
  assert.equal(assetMatches(v, 'EL-07', 'fire'), false);
  assert.equal(assetMatches(v, 'drill', null), false);
  assert.equal(assetMatches(v, '', null), true);
});

test('categoryLabel spells out a machine\'s plant kind and leaves anything else as typed', () => {
  assert.equal(categoryLabel({ asset_class: 'plant', category: 'excavator' }), 'Excavator');
  assert.equal(categoryLabel({ asset_class: 'electrical', category: 'Lead' }), 'Lead');
  assert.equal(categoryLabel({ asset_class: 'plant', category: null }), null);
});

test('presets and descriptions', () => {
  assert.ok(presetsFor('electrical').some((p) => p.label === 'Test and tag' && p.every === 3 && p.unit === 'month'));
  assert.ok(presetsFor('plant').some((p) => p.every_hours === 250));
  assert.equal(describeProfile({ every: 3, unit: 'month', every_hours: null }), 'every 3 months');
  assert.equal(describeProfile({ every: 1, unit: 'week', every_hours: 250 }), 'every week or every 250 h');
});
