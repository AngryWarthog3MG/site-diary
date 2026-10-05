import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignStep, buildStaff, filterStaff, summarise, ticketState, type StaffInput } from './model.ts';
import { competencies } from '../training/model.ts';

const TODAY = '2026-10-05';
const input = (over: Partial<StaffInput> = {}): StaffInput => ({
  staff: [
    { id: 's1', name: 'Evan Burke', role: 'Machine Op', phone: null, employer: null, notes: null, active: true },
    { id: 's2', name: 'Hamish Hayden', role: 'Labourer', phone: null, employer: 'Labour Hire Co', notes: null, active: true },
    { id: 's3', name: 'Old Hand', role: 'Labourer', phone: null, employer: null, notes: null, active: false },
    { id: 's4', name: 'New Starter', role: null, phone: null, employer: null, notes: null, active: true },
  ],
  jobs: [{ id: 'p1', code: 'C001', name: 'Curtin' }, { id: 'p2', code: 'C002', name: 'Deep Green Pad' }],
  crew: [
    { id: 'c1', project_id: 'p1', name: 'Evan Burke', role: 'Machine Op', active: true },
    { id: 'c2', project_id: 'p2', name: 'evan  burke', role: 'Truck Driver', active: true },
    { id: 'c3', project_id: 'p1', name: 'Hamish Hayden', role: 'Labourer', active: false },
    { id: 'c4', project_id: 'p1', name: 'Old Hand', role: 'Labourer', active: false },
  ],
  tickets: [
    { id: 't1', person_name: 'Evan Burke', ticket_type: 'excavator', ticket_no: 'X1', issued_on: null, expires_on: '2026-09-01', photo_path: null, active: true },
    { id: 't2', person_name: 'Evan Burke', ticket_type: 'white_card', ticket_no: null, issued_on: null, expires_on: null, photo_path: 'org/t2.jpg', active: true },
    { id: 't3', person_name: 'Evan Burke', ticket_type: 'first_aid', ticket_no: null, issued_on: null, expires_on: '2026-10-20', photo_path: null, active: true },
    { id: 't4', person_name: 'Evan Burke', ticket_type: 'roller', ticket_no: null, issued_on: null, expires_on: '2020-01-01', photo_path: null, active: false },
    { id: 't5', person_name: 'Hamish Hayden', ticket_type: 'site_induction_card', ticket_no: null, issued_on: '2026-01-15', expires_on: null, photo_path: null, active: true },
  ],
  inductions: [{ project_id: 'p1', person_name: 'Evan Burke', inducted_on: '2026-09-02', notes: 'Site rules' }],
  competencies: competencies([{ key: 'site_induction_card', label: 'Site induction card', valid_months: 6, active: true }]),
  requirements: [{ role: 'machine op', competency: 'excavator' }, { role: 'machine op', competency: 'white_card' }, { role: 'truck driver', competency: 'hr_licence' }, { role: 'labourer', competency: 'white_card' }],
  logins: [{ name: 'Evan Burke', projectCode: 'C001', role: 'Leading hand' }],
  ...over,
});

test('a ticket is current, expiring within 30 days, or expired; no expiry is current', () => {
  assert.equal(ticketState(null, TODAY), 'current');
  assert.equal(ticketState('2026-10-04', TODAY), 'expired');
  assert.equal(ticketState(TODAY, TODAY), 'expiring');
  assert.equal(ticketState('2026-11-04', TODAY), 'expiring');
  assert.equal(ticketState('2026-11-05', TODAY), 'current');
});

test('one person: their jobs, inductions, tickets and what their roles require, joined by name', () => {
  const evan = buildStaff(input(), TODAY).find((p) => p.name === 'Evan Burke')!;
  assert.deepEqual(evan.jobs.map((j) => [j.code, j.onCrew, j.jobRole, j.inductedOn]), [['C001', true, null, '2026-09-02'], ['C002', true, 'Truck Driver', null]]);
  assert.deepEqual(evan.notInducted, ['C002']);
  // The retired roller ticket is not held; the rest are, each with its state.
  assert.deepEqual(evan.tickets.map((t) => [t.key, t.state]), [['excavator', 'expired'], ['first_aid', 'expiring'], ['white_card', 'current']]);
  assert.equal(evan.worst, 'expired');
  // Machine Op needs an excavator ticket (expired) and a white card (held); the C002 role needs an HR licence (missing).
  assert.deepEqual(evan.gaps, ['Excavator ticket / VOC', 'Heavy rigid licence (HR)']);
  assert.deepEqual(evan.logins, ['Leading hand on C001']);
});

test('a custom competency with a validity counts from its issue date', () => {
  const hamish = buildStaff(input(), TODAY).find((p) => p.name === 'Hamish Hayden')!;
  assert.deepEqual(hamish.tickets.map((t) => [t.label, t.expiresOn, t.state]), [['Site induction card', '2026-07-15', 'expired']]);
  assert.deepEqual(hamish.gaps, ['White card']);
  // Hidden on C001's list: not on the job, so not "not inducted" there.
  assert.equal(hamish.jobs[0].onCrew, false);
  assert.equal(hamish.jobs[0].crewId, 'c3');
  assert.deepEqual(hamish.notInducted, []);
});

test('the figures count the people still with the company; the list puts them first', () => {
  const people = buildStaff(input(), TODAY);
  assert.deepEqual(people.map((p) => p.name), ['Evan Burke', 'Hamish Hayden', 'New Starter', 'Old Hand']);
  assert.deepEqual(summarise(people), { people: 3, onAJob: 1, noJob: 2, expired: 2, expiring: 1, notInducted: 1, gaps: 3, left: 1 });
  const starter = people.find((p) => p.name === 'New Starter')!;
  assert.equal(starter.worst, 'none');
  assert.deepEqual(starter.gaps, []); // no role, so nothing is required of them yet
});

test('filtering by name, job, no job and those who have left', () => {
  const people = buildStaff(input(), TODAY);
  assert.deepEqual(filterStaff(people, '', 'all', false).map((p) => p.name), ['Evan Burke', 'Hamish Hayden', 'New Starter']);
  assert.deepEqual(filterStaff(people, '', 'all', true).length, 4);
  assert.deepEqual(filterStaff(people, 'labour', 'all', false).map((p) => p.name), ['Hamish Hayden']);
  assert.deepEqual(filterStaff(people, '', 'p2', false).map((p) => p.name), ['Evan Burke']);
  assert.deepEqual(filterStaff(people, '', 'none', false).map((p) => p.name), ['Hamish Hayden', 'New Starter']);
});

test('assigning adds a crew row, shows a hidden one, or does nothing', () => {
  const people = buildStaff(input(), TODAY);
  const job = (name: string, code: string) => people.find((p) => p.name === name)!.jobs.find((j) => j.code === code)!;
  assert.equal(assignStep(job('Evan Burke', 'C001')), 'none');
  assert.equal(assignStep(job('Hamish Hayden', 'C001')), 'show');
  assert.equal(assignStep(job('Hamish Hayden', 'C002')), 'insert');
});
