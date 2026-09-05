import test from 'node:test';
import assert from 'node:assert/strict';
import { applyKnownNames, finishFrom } from './known-names.ts';
import type { ExtractionProposal } from './schema.ts';

const crew = [
  { name: 'Matthew Rodgers', role: 'Supervisor', aliases: ['Matty', 'Matty Rogers'] },
  { name: 'Marcus Hayden', role: 'Labourer', aliases: ['Markus'] },
  { name: 'Hamish Hayden', role: 'Labourer', aliases: [] },
  { name: 'Evan Burke', role: 'Machine Op', aliases: [] },
];
const plant = [
  { item: '1.8t Excavator', hire_type: 'dry', supplier: 'KBS', aliases: ['1.8 ton excavator'] },
  { item: 'Vac Trailer', hire_type: 'wet', supplier: 'MINIQUIP', aliases: ['trailer'] },
  { item: 'Vac Truck', hire_type: 'wet', supplier: 'MINIQUIP', aliases: [] },
];
const base = { source_quote: null, confidence: null } as const;
const proposal = (over: Partial<ExtractionProposal>): ExtractionProposal =>
  ({ labour: [], plant: [], work_items: [], variations: [], delays: [], pours: [], quantities: [], dayworks: [], ...over }) as unknown as ExtractionProposal;

test('"Marcus did 8 hours" becomes Marcus Hayden, 06:30 to 14:30', () => {
  const { proposal: out, matched } = applyKnownNames(
    proposal({ labour: [{ person_name: 'Marcus', role: null, area: null, start_time: null, finish_time: null, break_mins: null, hours: 8, overtime_hours: null, ...base }] } as never),
    crew, plant,
  );
  assert.equal(matched, 1);
  const p = out.labour[0];
  assert.equal(p.person_name, 'Marcus Hayden');
  assert.equal(p.role, 'Labourer');
  assert.equal(p.start_time, '06:30');
  assert.equal(p.finish_time, '14:30');
  assert.equal(p.hours, 8);
});

test('aliases and first names resolve; a stated break pushes the finish out', () => {
  const { proposal: out } = applyKnownNames(
    proposal({ labour: [
      { person_name: 'Matty Rogers', role: null, area: null, start_time: null, finish_time: null, break_mins: 30, hours: 8, overtime_hours: null, ...base },
      { person_name: 'markus', role: 'labourer', area: null, start_time: null, finish_time: null, break_mins: null, hours: null, overtime_hours: null, ...base },
    ] } as never),
    crew, plant,
  );
  assert.equal(out.labour[0].person_name, 'Matthew Rodgers');
  assert.equal(out.labour[0].finish_time, '15:00'); // 8h + 30 min break from 06:30
  assert.equal(out.labour[1].person_name, 'Marcus Hayden');
  assert.equal(out.labour[1].role, 'labourer'); // what was said stays
  assert.equal(out.labour[1].start_time, null); // no hours said: nothing laid out here
});

test('a stated time is never touched, and an unknown name stays as said', () => {
  const { proposal: out, matched } = applyKnownNames(
    proposal({ labour: [
      { person_name: 'Evan', role: null, area: null, start_time: '07:15', finish_time: null, break_mins: null, hours: 6, overtime_hours: null, ...base },
      { person_name: 'Dave', role: null, area: null, start_time: null, finish_time: null, break_mins: null, hours: 8, overtime_hours: null, ...base },
    ] } as never),
    crew, plant,
  );
  assert.equal(matched, 1);
  assert.equal(out.labour[0].person_name, 'Evan Burke');
  assert.equal(out.labour[0].start_time, '07:15');
  assert.equal(out.labour[0].finish_time, null);
  assert.equal(out.labour[1].person_name, 'Dave');
  assert.equal(out.labour[1].start_time, '06:30'); // hours said, so laid out — the name just is not known
});

test('two people sharing a first name stay as said', () => {
  const twoMarks = [...crew, { name: 'Marcus Lee', role: 'Labourer', aliases: [] }];
  const { proposal: out, matched } = applyKnownNames(
    proposal({ labour: [{ person_name: 'Marcus', role: null, area: null, start_time: null, finish_time: null, break_mins: null, hours: null, overtime_hours: null, ...base }] } as never),
    twoMarks, plant,
  );
  assert.equal(matched, 0);
  assert.equal(out.labour[0].person_name, 'Marcus');
});

test('"the excavator" is the listed 1.8t Excavator with its hire and supplier; "vac" is ambiguous', () => {
  const { proposal: out } = applyKnownNames(
    proposal({ plant: [
      { item: 'excavator', hire_type: null, hours: 8, idle_hours: null, supplier: null, ...base },
      { item: 'vac', hire_type: null, hours: 4, idle_hours: null, supplier: null, ...base },
    ] } as never),
    crew, plant,
  );
  assert.equal(out.plant[0].item, '1.8t Excavator');
  assert.equal(out.plant[0].hire_type, 'dry');
  assert.equal(out.plant[0].supplier, 'KBS');
  assert.equal(out.plant[1].item, 'vac'); // matches both Vac Trailer and Vac Truck: left alone
});

test('finishFrom wraps past midnight', () => {
  assert.equal(finishFrom('22:00', 8), '06:00');
  assert.equal(finishFrom('06:30', 8.5), '15:00');
});

test('a decorated "20t excavator" still lands on the one listed excavator; two listed stay as said', () => {
  const one = applyKnownNames(
    proposal({ plant: [{ item: '20t excavator', hire_type: null, hours: 6, idle_hours: null, supplier: null, ...base }] } as never),
    crew, plant,
  );
  assert.equal(one.proposal.plant[0].item, '1.8t Excavator');
  const two = applyKnownNames(
    proposal({ plant: [{ item: '20t excavator', hire_type: null, hours: 6, idle_hours: null, supplier: null, ...base }] } as never),
    crew, [...plant, { item: '5t Excavator', hire_type: 'dry', supplier: 'KBS', aliases: ['excavator'] }],
  );
  assert.equal(two.proposal.plant[0].item, '20t excavator');
});
