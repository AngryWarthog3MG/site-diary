import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  attendedHours, bookingKey, bookingsByPerson, classProblems, classStateText, classWhen, classWhenText, courseProblems, seatsLeft, sortClasses,
  spanHours, summariseClasses, ticketBlocker, ticketDates, trainingReport,
  type AttendeeRow, type ClassRow, type CourseRow,
} from './courses.ts';

const course = (over: Partial<CourseRow> = {}): CourseRow => ({
  id: 'k1', org_id: 'o', code: 'VOC-EXC', name: 'Excavator VOC', kind: 'voc', unit_of_competency: 'RIIMPO320F', duration_hours: 4, expiry_months: 36,
  provider: 'internal', provider_name: null, competency_key: 'excavator', notes: null, active: true, ...over,
});
// 03/11/2026 07:00 Perth = 2026-11-02T23:00:00Z: the UTC day is the day before, which is the whole point of Perth days.
const cls = (over: Partial<ClassRow> = {}): ClassRow => ({
  id: 'c1', org_id: 'o', course_id: 'k1', project_id: null, starts_at: '2026-11-02T23:00:00Z', ends_at: '2026-11-03T03:30:00Z', venue: 'Yard', trainer_name: 'Sue',
  capacity: 2, status: 'scheduled', held_at: null, cancelled_at: null, cancelled_reason: null, notes: null, ...over,
});
const att = (over: Partial<AttendeeRow> = {}): AttendeeRow => ({
  id: 'a1', class_id: 'c1', person_name: 'Danny Test', status: 'booked', hours: null, result: null, notes: null, booked_at: '2026-11-01T00:00:00Z', marked_at: null, ...over,
});
const KEYS = new Set(['excavator', 'white_card', 'site_induction']);

test('courseProblems: the trigger\'s rules', () => {
  assert.deepEqual(courseProblems(course(), KEYS), []);
  assert.ok(courseProblems(course({ code: 'has space' }), KEYS).some((p) => p.includes('code')));
  assert.ok(courseProblems(course({ provider: 'external', provider_name: null }), KEYS).some((p) => p.includes('provider')));
  assert.ok(courseProblems(course({ competency_key: 'not_kept' }), KEYS).some((p) => p.includes('competency')));
  assert.ok(courseProblems(course({ expiry_months: 0 }), KEYS).some((p) => p.includes('Expiry')));
  assert.ok(courseProblems(course({ duration_hours: 0 }), KEYS).some((p) => p.includes('Duration')));
  assert.deepEqual(courseProblems(course({ competency_key: null, expiry_months: null, duration_hours: null }), KEYS), []);
});

test('classProblems: an end after the start, whole seats', () => {
  assert.deepEqual(classProblems({ course_id: 'k1', starts_at: '2026-11-02T23:00:00Z', ends_at: null, capacity: null }), []);
  assert.ok(classProblems({ course_id: 'k1', starts_at: '2026-11-02T23:00:00Z', ends_at: '2026-11-02T22:00:00Z', capacity: 1 }).some((p) => p.includes('ends after')));
  assert.ok(classProblems({ course_id: '', starts_at: 'nope', ends_at: null, capacity: 1.5 }).length === 3);
});

test('spanHours and attendedHours: given, else the span, else the course, else not recorded', () => {
  assert.equal(spanHours(cls()), 4.5);
  assert.equal(spanHours(cls({ ends_at: null })), null);
  assert.equal(attendedHours(att({ status: 'attended', hours: 3 }), cls(), course()), 3);
  assert.equal(attendedHours(att({ status: 'attended' }), cls(), course()), 4.5);
  assert.equal(attendedHours(att({ status: 'attended' }), cls({ ends_at: null }), course()), 4);
  assert.equal(attendedHours(att({ status: 'attended' }), cls({ ends_at: null }), course({ duration_hours: null })), null);
  assert.equal(attendedHours(att({ status: 'booked' }), cls(), course()), null);
});

test('seatsLeft counts booked and attended, never below zero, null without a cap', () => {
  assert.equal(seatsLeft(cls(), [att(), att({ id: 'a2', status: 'attended' }), att({ id: 'a3', status: 'withdrawn' })]), 0);
  assert.equal(seatsLeft(cls({ capacity: 5 }), [att()]), 4);
  assert.equal(seatsLeft(cls({ capacity: null }), [att()]), null);
});

test('classWhen and the state line are Perth\'s day', () => {
  assert.equal(classWhen(cls(), '2026-11-03'), 'today');
  assert.equal(classWhen(cls(), '2026-11-02'), 'upcoming');
  assert.equal(classWhen(cls(), '2026-11-04'), 'past');
  assert.equal(classStateText(cls(), '2026-11-04'), 'Run, not yet marked');
  assert.equal(classStateText(cls({ status: 'held' }), '2026-11-04'), 'Held');
  assert.equal(classStateText(cls({ status: 'cancelled', cancelled_reason: 'Trainer sick' }), '2026-11-01'), 'Cancelled');
  assert.equal(classWhenText(cls()), 'Tue 03/11/2026 07:00–11:30');
  assert.deepEqual(sortClasses([cls({ id: 'b', starts_at: '2026-12-01T00:00:00Z' }), cls({ id: 'a' })]).map((c) => c.id), ['a', 'b']);
});

test('bookingsByPerson: standing bookings on scheduled classes from today, soonest day, keyed by name and competency', () => {
  const classes = [cls(), cls({ id: 'c2', starts_at: '2026-11-09T23:00:00Z' }), cls({ id: 'c3', status: 'cancelled', cancelled_reason: 'x', starts_at: '2026-11-01T23:00:00Z' })];
  const atts = [att({ class_id: 'c2' }), att({ id: 'a2', class_id: 'c1', person_name: 'danny  test' }), att({ id: 'a3', class_id: 'c3', person_name: 'Sam' }), att({ id: 'a4', class_id: 'c1', person_name: 'Lee', status: 'withdrawn', marked_at: 'x' })];
  const m = bookingsByPerson(atts, classes, [course()], '2026-11-03');
  assert.equal(m.get(bookingKey('Danny Test', 'excavator')), '2026-11-03');
  assert.equal(m.has(bookingKey('Sam', 'excavator')), false, 'a cancelled class is no booking');
  assert.equal(m.has(bookingKey('Lee', 'excavator')), false, 'withdrawn is no booking');
  assert.equal(bookingsByPerson(atts, classes, [course()], '2026-11-04').get(bookingKey('Danny Test', 'excavator')), '2026-11-10', 'yesterday\'s class no longer counts');
  assert.equal(bookingsByPerson(atts, classes, [course({ competency_key: null })], '2026-11-03').size, 0, 'a course that earns no ticket marks nothing');
});

test('ticketBlocker and ticketDates: the trigger\'s rules and defaults', () => {
  assert.equal(ticketBlocker(att({ status: 'attended', result: 'pass' }), course(), false), null);
  assert.match(ticketBlocker(att({ status: 'attended', result: 'pass' }), course({ competency_key: null }), false) ?? '', /no ticket/);
  assert.match(ticketBlocker(att({ status: 'booked' }), course(), false) ?? '', /attended/);
  assert.match(ticketBlocker(att({ status: 'attended', result: null }), course(), false) ?? '', /competent/);
  assert.match(ticketBlocker(att({ status: 'attended', result: 'pass' }), course(), true) ?? '', /already/);
  assert.deepEqual(ticketDates(cls(), course()), { issued_on: '2026-11-03', expires_on: '2029-11-03' });
  assert.deepEqual(ticketDates(cls(), course({ expiry_months: null })), { issued_on: '2026-11-03', expires_on: null });
});

test('trainingReport: attended lines in the window, hours summed where known, unrecorded said', () => {
  const classes = [cls({ status: 'held' }), cls({ id: 'c2', status: 'held', starts_at: '2026-10-01T00:00:00Z', ends_at: null }), cls({ id: 'c3', status: 'cancelled', cancelled_reason: 'x' })];
  const courses = [course(), course({ id: 'k2', code: 'IND', name: 'Site induction', kind: 'induction', duration_hours: null, competency_key: 'site_induction' })];
  const c2 = { ...classes[1], course_id: 'k2' }; classes[1] = c2;
  const atts = [
    att({ id: 'a1', status: 'attended', result: 'pass', marked_at: 'x' }),
    att({ id: 'a2', status: 'attended', result: 'fail', hours: 2, person_name: 'Sam Test', marked_at: 'x' }),
    att({ id: 'a3', class_id: 'c2', status: 'attended', marked_at: 'x' }),
    att({ id: 'a4', status: 'absent', marked_at: 'x', person_name: 'Lee' }),
    att({ id: 'a5', class_id: 'c3', status: 'attended', marked_at: 'x', person_name: 'Nobody' }),
  ];
  const r = trainingReport(atts, classes, courses, new Set(['a1']), '2026-10-01', '2026-11-30');
  assert.equal(r.lines.length, 3);
  assert.deepEqual(r.lines.map((l) => [l.person_name, l.course_code, l.hours, l.ticketRecorded]), [['Danny Test', 'IND', null, false], ['Danny Test', 'VOC-EXC', 4.5, true], ['Sam Test', 'VOC-EXC', 2, false]]);
  assert.equal(r.totalHours, 6.5);
  assert.equal(r.unrecorded, 1);
  assert.deepEqual(r.people.map((p) => [p.person_name, p.hours, p.lines, p.unrecorded, p.passed, p.failed]), [['Danny Test', 4.5, 2, 1, 1, 0], ['Sam Test', 2, 1, 0, 0, 1]]);
  assert.equal(trainingReport(atts, classes, courses, new Set(), '2026-11-04', '2026-11-30').lines.length, 0);
});

test('summariseClasses: upcoming, today, run-not-marked, held this year, bookings standing', () => {
  const classes = [cls(), cls({ id: 'c2', starts_at: '2026-11-09T23:00:00Z' }), cls({ id: 'c3', starts_at: '2026-10-01T00:00:00Z' }), cls({ id: 'c4', status: 'held', starts_at: '2026-09-01T00:00:00Z' }), cls({ id: 'c5', status: 'held', starts_at: '2025-09-01T00:00:00Z' }), cls({ id: 'c6', status: 'cancelled', cancelled_reason: 'x' })];
  const atts = [att(), att({ id: 'a2', class_id: 'c2' }), att({ id: 'a3', class_id: 'c3' }), att({ id: 'a4', class_id: 'c6' })];
  assert.deepEqual(summariseClasses(classes, atts, '2026-11-03'), { upcoming: 1, today: 1, needsMarking: 1, booked: 2, heldThisYear: 1 });
});
