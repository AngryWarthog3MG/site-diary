import test from 'node:test';
import assert from 'node:assert/strict';
import { cellFor, buildMatrix, mergePeople, competencies, effectiveExpiry } from './model.ts';

const today = '2026-09-14';
test('a cell is current, expiring, expired or missing from the best ticket', () => {
  assert.equal(cellFor([], 'white_card', true, today).state, 'missing');
  assert.equal(cellFor([{ ticket_type: 'white_card', expires_on: null, active: true }], 'white_card', true, today).state, 'current');
  assert.equal(cellFor([{ ticket_type: 'first_aid', expires_on: '2026-09-30', active: true }], 'first_aid', false, today).state, 'expiring');
  assert.equal(cellFor([{ ticket_type: 'first_aid', expires_on: '2026-01-01', active: true }, { ticket_type: 'first_aid', expires_on: '2027-01-01', active: false }], 'first_aid', false, today).state, 'expired');
});
test('a custom competency with a validity expires from its issue date; one name with two roles owes both', () => {
  assert.equal(effectiveExpiry({ ticket_type: 'kbs_induction', expires_on: null, active: true, issued_on: '2025-01-01' }, 12), '2026-01-01');
  // Month-end issue dates clamp to the end of the target month rather than rolling into the next one.
  assert.equal(effectiveExpiry({ ticket_type: 'kbs_induction', expires_on: null, active: true, issued_on: '2026-01-31' }, 1), '2026-02-28');
  assert.equal(effectiveExpiry({ ticket_type: 'kbs_induction', expires_on: null, active: true, issued_on: '2024-02-29' }, 12), '2025-02-28');
  assert.equal(effectiveExpiry({ ticket_type: 'kbs_induction', expires_on: null, active: true, issued_on: '2025-11-30' }, 3), '2026-02-28');
  assert.equal(cellFor([{ ticket_type: 'kbs_induction', expires_on: null, active: true, issued_on: '2025-01-01' }], 'kbs_induction', true, today, 30, 12).state, 'expired');
  const people = mergePeople([{ name: 'Chris Lee', role: 'Labourer' }, { name: 'chris lee', role: 'Operator' }], []);
  assert.equal(people.length, 1);
  assert.deepEqual(people[0].roles, ['Labourer', 'Operator']);
  const { rows } = buildMatrix(people, competencies([]), [{ role: 'operator', competency: 'excavator' }, { role: 'labourer', competency: 'white_card' }], today);
  assert.deepEqual(rows[0].gaps.sort(), ['Excavator ticket / VOC', 'White card']);
  assert.equal(rows[0].role, 'Labourer / Operator');
  const cols = competencies([{ key: 'old', label: 'Old thing', active: false }]);
  assert.equal(cols.find((c) => c.key === 'old')?.label, 'Old thing (retired)');
});
test('the matrix marks gaps only where the role requires it, and drops empty columns', () => {
  const people = mergePeople(
    [{ name: 'Danny Rowe', role: 'Operator' }, { name: 'Sam Whitely', role: 'Labourer' }],
    [{ person_name: 'danny  rowe', ticket_type: 'excavator', expires_on: '2027-01-01', active: true }, { person_name: 'Kel Brady', ticket_type: 'first_aid', expires_on: '2026-09-20', active: true }],
  );
  assert.equal(people.length, 3);
  const { rows, columns } = buildMatrix(people, competencies([{ key: 'kbs_induction', label: 'KBS induction' }]), [{ role: 'operator', competency: 'excavator' }, { role: 'operator', competency: 'white_card' }, { role: 'labourer', competency: 'white_card' }], today);
  const danny = rows.find((r) => r.name === 'Danny Rowe')!;
  assert.deepEqual(danny.gaps, ['White card']);
  const kel = rows.find((r) => r.name === 'Kel Brady')!;
  assert.deepEqual(kel.expiring, ['First aid']);
  assert.deepEqual(kel.gaps, []);
  assert.deepEqual(columns.map((c) => c.key).sort(), ['excavator', 'first_aid', 'white_card']);
});
