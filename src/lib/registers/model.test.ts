import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calibrationRegister, chemicalsRegister, fmtDay, plantRegister, type ChemLine, type EquipmentRow, type PlantRecord, type PlantRow } from './model.ts';
import { registerBodyHtml } from './html.ts';

const TODAY = '2026-09-30';
const machine = (over: Partial<PlantRow>): PlantRow => ({
  id: 'p1', name: 'Excavator 5t', kind: 'excavator', make_model: 'Kubota U55', plant_no: 'KB-01', ownership: 'own', supplier: null, active: true,
  inspection_basis: null, inspection_interval_months: null, registration_required: false, registration_no: null, registration_expires_on: null, ...over,
});
const rec = (over: Partial<PlantRecord>): PlantRecord => ({ plant_id: 'p1', kind: 'inspection', done_on: '2026-01-10', next_due_on: null, outcome: 'pass', performed_by_name: 'J. Fitter', organisation: 'Hire Co', ...over });

test('dates print day first, and nothing prints as a date when there is none', () => {
  assert.equal(fmtDay('2026-09-05'), '05/09/2026');
  assert.equal(fmtDay(null), '—');
  assert.equal(fmtDay('soon'), '—');
});

test('plant: a machine with a basis and no inspection is due now; one with no schedule says so', () => {
  const doc = plantRegister([machine({ inspection_basis: 'annual' }), machine({ id: 'p2', name: 'Roller', plant_no: 'KB-02', kind: 'roller' })], [], new Map([['p1', ['C001', 'C010']]]), TODAY);
  const [a, b] = doc.sections[0].rows;
  assert.equal(a[0].text, 'KB-01');
  assert.deepEqual([a[6].text, a[6].sub, a[6].tone], ['Due now', 'No inspection on record', 'bad']);
  assert.equal(a[5].text, 'None on record');
  assert.equal(a[7].text, 'C001, C010');
  assert.deepEqual([b[6].text, b[6].tone], ['No schedule set', 'none']);
  assert.equal(b[7].text, '—');
  assert.equal(b[2].text, 'Roller / compactor');
});

test('plant: the interval counts from the last inspection; the inspector’s own date wins; maintenance does not reset it', () => {
  const p = machine({ inspection_basis: 'annual' });
  const overdue = plantRegister([p], [rec({ done_on: '2025-08-01' }), rec({ kind: 'maintenance', done_on: '2026-09-01' })], new Map(), TODAY).sections[0].rows[0];
  assert.deepEqual([overdue[6].text, overdue[6].tone], ['01/08/2026', 'bad']);
  assert.match(overdue[6].sub ?? '', /^Overdue/);
  assert.equal(overdue[5].text, '01/08/2025');
  const set = plantRegister([p], [rec({ done_on: '2026-09-01', next_due_on: '2026-10-15' })], new Map(), TODAY).sections[0].rows[0];
  assert.deepEqual([set[6].text, set[6].tone], ['15/10/2026', 'warn']);
  assert.match(set[6].sub ?? '', /Date set by the inspector/);
});

test('plant: registration is not required unless the machine says so, and a lapsed one is red', () => {
  const rows = plantRegister([
    machine({}),
    machine({ id: 'p2', plant_no: 'KB-02', registration_required: true }),
    machine({ id: 'p3', plant_no: 'KB-03', registration_required: true, registration_no: 'WA-123', registration_expires_on: '2026-08-31' }),
    machine({ id: 'p4', plant_no: 'KB-04', registration_required: true, registration_no: 'WA-456', registration_expires_on: '2027-08-31' }),
  ], [], new Map(), TODAY).sections[0].rows;
  assert.deepEqual(rows.map((r) => [r[4].text, r[4].tone]), [['Not required', 'none'], ['Required — none recorded', 'bad'], ['Lapsed', 'bad'], ['Registered', 'ok']]);
  assert.equal(rows[3][4].sub, 'No. WA-456 · expires 31/08/2027');
});

test('plant: retired machines are kept apart, and an empty register says what it would hold', () => {
  const doc = plantRegister([machine({ active: false })], [], new Map(), TODAY);
  assert.equal(doc.sections[0].rows.length, 0);
  assert.match(doc.sections[0].empty, /No plant is recorded/);
  assert.equal(doc.sections[1].heading, 'Retired — kept for the record');
  assert.equal(plantRegister([], [], new Map(), TODAY).sections.length, 1);
});

const chem = (over: Partial<ChemLine>): ChemLine => ({
  name: 'Diesel', manufacturer: 'BP', product_code: null, hazardClasses: ['flammable_liquid', 'aspiration'], dgClass: '3', usedFor: 'Fuel for plant',
  location: 'Bunded fuel pod', quantity: '1000 L', sheets: [{ id: 's1', issued_on: '2024-03-01', version: '4', file_path: 'x.pdf', active: true }], ...over,
});

test('chemicals: a sheet is current for five years; older is out of date; none held is said plainly', () => {
  const doc = chemicalsRegister([
    chem({}),
    chem({ name: 'Form oil', sheets: [{ id: 's2', issued_on: '2021-09-01', version: null, file_path: 'y.pdf', active: true }] }),
    chem({ name: 'Primer', sheets: [] }),
    chem({ name: 'Curing compound', sheets: [{ id: 's3', issued_on: '2025-01-01', version: null, file_path: null, active: true }] }),
  ], [chem({ name: 'Zinc spray', location: null, quantity: null })], TODAY);
  const by = Object.fromEntries(doc.sections[0].rows.map((r) => [r[0].text, r]));
  assert.deepEqual([by.Diesel[4].text, by.Diesel[5].text, by.Diesel[6].text, by.Diesel[6].tone], ['01/03/2024', '01/03/2029', 'Sheet current', 'ok']);
  assert.equal(by.Diesel[1].text, 'Flammable liquid; Aspiration hazard');
  assert.equal(by.Diesel[1].sub, 'Dangerous goods class 3');
  assert.deepEqual([by['Form oil'][6].text, by['Form oil'][6].tone], ['Sheet out of date', 'bad']);
  assert.deepEqual([by.Primer[4].text, by.Primer[6].text], ['None held', 'No safety data sheet']);
  assert.equal(by['Curing compound'][6].text, 'Sheet recorded, file missing');
  assert.equal(doc.sections[1].rows[0][0].text, 'Zinc spray');
  assert.match(doc.summary[1], /1 current · 3 needing attention/);
});

test('chemicals: an empty workplace prints empty, never an example', () => {
  const doc = chemicalsRegister([], [], TODAY);
  assert.equal(doc.sections.length, 1);
  assert.equal(doc.sections[0].rows.length, 0);
  assert.match(doc.sections[0].empty, /No hazardous chemicals are recorded/);
  assert.match(doc.summary[0], /^0 hazardous chemicals/);
});

const gauge = (over: Partial<EquipmentRow>): EquipmentRow => ({
  id: 'e1', name: 'Nuclear density gauge', serial_no: 'NDG-7731', kind: 'Density', calibration_interval_months: 12, active: true,
  calibrations: [{ calibrated_on: '2026-02-01', due_on: '2027-02-01', certificate_no: 'C-1001', calibrated_by: 'NATA Lab' }], ...over,
});

test('calibration: in, due soon, out and none — by the latest certificate', () => {
  const doc = calibrationRegister([
    gauge({}),
    gauge({ id: 'e2', name: 'Dumpy level', serial_no: 'L-22', calibrations: [{ calibrated_on: '2025-10-10', due_on: '2026-10-10', certificate_no: 'C-0900', calibrated_by: null }] }),
    gauge({ id: 'e3', name: 'Slump cone', serial_no: null, calibrations: [{ calibrated_on: '2025-01-01', due_on: '2026-01-01', certificate_no: 'C-0500', calibrated_by: 'Lab' }] }),
    gauge({ id: 'e4', name: 'Tape', serial_no: 'T-1', calibration_interval_months: null, calibrations: [] }),
  ], TODAY);
  const by = Object.fromEntries(doc.sections[0].rows.map((r) => [r[0].text, r]));
  assert.deepEqual([by['Nuclear density gauge'][3].text, by['Nuclear density gauge'][4].text, by['Nuclear density gauge'][5].text, by['Nuclear density gauge'][6].text], ['01/02/2026', 'C-1001', '01/02/2027', 'In calibration']);
  assert.equal(by['Nuclear density gauge'][3].sub, 'NATA Lab');
  assert.deepEqual([by['Dumpy level'][6].text, by['Dumpy level'][6].tone], ['Calibration due soon', 'warn']);
  assert.deepEqual([by['Slump cone'][6].text, by['Slump cone'][6].tone, by['Slump cone'][1].text], ['Out of calibration', 'bad', '—']);
  assert.deepEqual([by.Tape[3].text, by.Tape[2].text, by.Tape[6].text], ['None on record', 'Not set', 'No calibration recorded']);
  const history = doc.sections.find((s) => s.heading === 'Calibration history');
  assert.deepEqual(history?.rows.map((r) => r[2].text), ['01/02/2026', '10/10/2025', '01/01/2025']);
});

test('calibration: empty prints empty and has no history section', () => {
  const doc = calibrationRegister([], TODAY);
  assert.equal(doc.sections.length, 1);
  assert.match(doc.sections[0].empty, /No measuring equipment is recorded/);
});

test('the page escapes what people typed and marks red and amber cells', () => {
  const doc = plantRegister([machine({ name: 'Bobcat <T590>', inspection_basis: 'annual' })], [], new Map(), TODAY);
  const html = registerBodyHtml(doc, { orgName: 'Kooboolong & Co', scope: 'The whole company', asOf: TODAY, logo: 'data:image/png;base64,AA' });
  assert.match(html, /Bobcat &lt;T590&gt;/);
  assert.match(html, /Kooboolong &amp; Co/);
  assert.match(html, /<td class="bad">Due now<span class="sub2">No inspection on record<\/span><\/td>/);
  assert.match(html, /30\/09\/2026/);
});
