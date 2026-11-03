-- Training courses and classes (README R188): a course names a competency the company keeps and its provider when
-- external; a class is born scheduled and is held only once it has started, cancelled only with a reason, then
-- frozen; a booking is one per person per class and refused past the seats; attended fills the hours from the
-- class's clocks, else the course, never a guess; marked is frozen; a ticket stands on an attendance marked
-- competent, of this person, for the competency the course earns, once; nothing is deleted; the labourer reads none.
begin;
create schema tests;
grant usage on schema tests to public;
create function tests.expect_error(p_sql text, p_fragment text)
returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'TESTFAIL: expected failure but statement succeeded: %', p_sql;
exception
  when others then
    if sqlerrm like 'TESTFAIL:%' then raise; end if;
    if position(lower(p_fragment) in lower(sqlerrm)) = 0 then
      raise exception 'TESTFAIL: wrong error for [%] — got "%", expected "%"', p_sql, sqlerrm, p_fragment;
    end if;
end;
$$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-ac74-000000000001', 'sup74@example.com'),
  ('00000000-0000-0000-ac74-000000000002', 'lh74@example.com'),
  ('00000000-0000-0000-ac74-000000000003', 'lab74@example.com'),
  ('00000000-0000-0000-ac74-000000000005', 'pm74@example.com'),
  ('00000000-0000-0000-ac74-000000000006', 'sup74b@example.com');
insert into public.profiles (id, email, full_name) values
  ('00000000-0000-0000-ac74-000000000001', 'sup74@example.com', 'Sue Pervisor'),
  ('00000000-0000-0000-ac74-000000000002', 'lh74@example.com', 'Lee Hand'),
  ('00000000-0000-0000-ac74-000000000003', 'lab74@example.com', 'Sam Labourer'),
  ('00000000-0000-0000-ac74-000000000005', 'pm74@example.com', 'Pat Manager'),
  ('00000000-0000-0000-ac74-000000000006', 'sup74b@example.com', 'Other Company')
  on conflict (id) do nothing;
insert into public.organisations (id, name, code) values
  ('aaaaaaaa-0000-0000-ac74-000000000001', 'Kingsbridge Civil', 'KB74'),
  ('aaaaaaaa-0000-0000-ac74-000000000002', 'Other Civil', 'OC74');
insert into public.projects (id, org_id, name, code) values
  ('bbbbbbbb-0000-0000-ac74-000000000001', 'aaaaaaaa-0000-0000-ac74-000000000001', 'Northern', 'C074'),
  ('bbbbbbbb-0000-0000-ac74-000000000002', 'aaaaaaaa-0000-0000-ac74-000000000002', 'Elsewhere', 'X074');
insert into public.project_members (project_id, user_id, role) values
  ('bbbbbbbb-0000-0000-ac74-000000000001', '00000000-0000-0000-ac74-000000000001', 'supervisor'),
  ('bbbbbbbb-0000-0000-ac74-000000000001', '00000000-0000-0000-ac74-000000000002', 'leading_hand'),
  ('bbbbbbbb-0000-0000-ac74-000000000001', '00000000-0000-0000-ac74-000000000003', 'labourer'),
  ('bbbbbbbb-0000-0000-ac74-000000000001', '00000000-0000-0000-ac74-000000000005', 'pm'),
  ('bbbbbbbb-0000-0000-ac74-000000000002', '00000000-0000-0000-ac74-000000000006', 'supervisor');
insert into public.org_competencies (org_id, key, label, valid_months) values
  ('aaaaaaaa-0000-0000-ac74-000000000001', 'site_induction', 'Site induction', 12);
-- The other company's course, for the cross-company refusals.
insert into public.training_courses (id, org_id, code, name, kind) values
  ('dddddddd-0000-0000-ac74-000000000009', 'aaaaaaaa-0000-0000-ac74-000000000002', 'X-1', 'Theirs', 'internal');

-- 1. Courses: the supervisor and the PM keep them; an external course names its provider; the competency is one
--    the company keeps; a code is one course per company, whatever the case; the leading hand cannot; never deleted.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-ac74-000000000001","role":"authenticated"}', true);
set local role authenticated;
insert into public.training_courses (id, org_id, code, name, kind, unit_of_competency, duration_hours, expiry_months, competency_key) values
  ('dddddddd-0000-0000-ac74-000000000001', 'aaaaaaaa-0000-0000-ac74-000000000001', ' VOC-EXC ', '  Excavator   VOC ', 'voc', 'RIIMPO320F', 4, 36, 'excavator');
select tests.expect_error($q$ insert into public.training_courses (org_id, code, name, kind, provider) values ('aaaaaaaa-0000-0000-ac74-000000000001', 'HRWL', 'Forklift licence', 'high_risk_licence', 'external') $q$, 'names its provider');
select tests.expect_error($q$ insert into public.training_courses (org_id, code, name, kind, competency_key) values ('aaaaaaaa-0000-0000-ac74-000000000001', 'ZZ', 'Nothing', 'internal', 'not_kept') $q$, 'not one the company keeps');
select tests.expect_error($q$ insert into public.training_courses (org_id, code, name, kind) values ('aaaaaaaa-0000-0000-ac74-000000000001', 'voc-exc', 'Again', 'voc') $q$, 'training_courses_code_once');
select tests.expect_error($q$ insert into public.training_courses (org_id, code, name, kind) values ('aaaaaaaa-0000-0000-ac74-000000000001', 'has space', 'Bad code', 'voc') $q$, 'training_courses_code_check');
do $$ declare r record; begin
  select * into r from public.training_courses where id = 'dddddddd-0000-0000-ac74-000000000001';
  assert r.code = 'VOC-EXC' and r.name = 'Excavator VOC' and r.active and r.created_by = '00000000-0000-0000-ac74-000000000001', 'tidied and the author''s: ' || row_to_json(r)::text;
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-ac74-000000000005","role":"authenticated"}', true);
insert into public.training_courses (id, org_id, code, name, kind, duration_hours, expiry_months, provider, provider_name, competency_key) values
  ('dddddddd-0000-0000-ac74-000000000002', 'aaaaaaaa-0000-0000-ac74-000000000001', 'IND', 'Site induction', 'induction', 2, 12, 'external', 'Head Contractor Pty Ltd', 'site_induction');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-ac74-000000000002","role":"authenticated"}', true);
select tests.expect_error($q$ insert into public.training_courses (org_id, code, name, kind) values ('aaaaaaaa-0000-0000-ac74-000000000001', 'LH', 'By the leading hand', 'internal') $q$, 'row-level security');
reset role;
select tests.expect_error($q$ delete from public.training_courses where id = 'dddddddd-0000-0000-ac74-000000000001' $q$, 'never deleted');
do $$ begin raise notice 'PASS  1 courses are kept by the supervisor and the office, tidied, one per code, never deleted'; end $$;

-- 2. Classes: born scheduled; the course and the job must be the company's; ends after it starts; held only once
--    started; cancelled only with a reason, then frozen; never deleted.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-ac74-000000000001","role":"authenticated"}', true);
set local role authenticated;
-- 06/10/2026 07:00–11:30 Perth: a class that has run.
insert into public.training_classes (id, org_id, course_id, project_id, starts_at, ends_at, venue, trainer_name, capacity) values
  ('cccccccc-0000-0000-ac74-000000000001', 'aaaaaaaa-0000-0000-ac74-000000000001', 'dddddddd-0000-0000-ac74-000000000001', 'bbbbbbbb-0000-0000-ac74-000000000001', '2026-10-05 23:00+00', '2026-10-06 03:30+00', ' The  yard ', 'Sue', 2);
-- A class still to come, with no end clock.
insert into public.training_classes (id, org_id, course_id, starts_at) values
  ('cccccccc-0000-0000-ac74-000000000002', 'aaaaaaaa-0000-0000-ac74-000000000001', 'dddddddd-0000-0000-ac74-000000000002', '2027-01-10 23:00+00');
-- A past class of the induction, no end clock: the hours come from the course.
insert into public.training_classes (id, org_id, course_id, starts_at) values
  ('cccccccc-0000-0000-ac74-000000000003', 'aaaaaaaa-0000-0000-ac74-000000000001', 'dddddddd-0000-0000-ac74-000000000002', '2026-09-01 00:00+00');
select tests.expect_error($q$ insert into public.training_classes (org_id, course_id, starts_at, status) values ('aaaaaaaa-0000-0000-ac74-000000000001', 'dddddddd-0000-0000-ac74-000000000001', '2027-02-01 00:00+00', 'held') $q$, 'born scheduled');
select tests.expect_error($q$ insert into public.training_classes (org_id, course_id, starts_at) values ('aaaaaaaa-0000-0000-ac74-000000000001', 'dddddddd-0000-0000-ac74-000000000009', '2027-02-01 00:00+00') $q$, 'another company');
select tests.expect_error($q$ insert into public.training_classes (org_id, course_id, project_id, starts_at) values ('aaaaaaaa-0000-0000-ac74-000000000001', 'dddddddd-0000-0000-ac74-000000000001', 'bbbbbbbb-0000-0000-ac74-000000000002', '2027-02-01 00:00+00') $q$, 'another company');
select tests.expect_error($q$ insert into public.training_classes (org_id, course_id, starts_at, ends_at) values ('aaaaaaaa-0000-0000-ac74-000000000001', 'dddddddd-0000-0000-ac74-000000000001', '2027-02-01 03:00+00', '2027-02-01 02:00+00') $q$, 'check constraint');
select tests.expect_error($q$ update public.training_classes set status = 'held' where id = 'cccccccc-0000-0000-ac74-000000000002' $q$, 'once it has started');
select tests.expect_error($q$ update public.training_classes set status = 'cancelled' where id = 'cccccccc-0000-0000-ac74-000000000002' $q$, 'training_classes_cancel_whole');
do $$ declare r record; begin
  select * into r from public.training_classes where id = 'cccccccc-0000-0000-ac74-000000000001';
  assert r.status = 'scheduled' and r.venue = 'The yard' and r.held_at is null, 'born scheduled and tidy: ' || row_to_json(r)::text;
  assert app.training_class_span_hours('cccccccc-0000-0000-ac74-000000000001') = 4.5, 'the span is 4.5 hours';
  assert app.training_class_span_hours('cccccccc-0000-0000-ac74-000000000002') is null, 'no end, no span';
end $$;
reset role;
select tests.expect_error($q$ delete from public.training_classes where id = 'cccccccc-0000-0000-ac74-000000000002' $q$, 'never deleted');
do $$ begin raise notice 'PASS  2 a class is born scheduled, of the company''s course and job, held once started, cancelled with a reason'; end $$;

-- 3. Bookings: one per person per class whatever the spelling; refused past the seats; born booked; attended only
--    once the class has started; attended takes the hours from the clocks, else the course; marked is frozen; a
--    withdrawn seat frees up; nobody books onto a cancelled class; never deleted.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-ac74-000000000001","role":"authenticated"}', true);
set local role authenticated;
insert into public.training_class_attendees (id, class_id, person_name) values
  ('eeeeeeee-0000-0000-ac74-000000000001', 'cccccccc-0000-0000-ac74-000000000001', '  Danny   Test '),
  ('eeeeeeee-0000-0000-ac74-000000000002', 'cccccccc-0000-0000-ac74-000000000001', 'Sam Test');
insert into public.training_class_attendees (id, class_id, person_name) values ('eeeeeeee-0000-0000-ac74-000000000004', 'cccccccc-0000-0000-ac74-000000000003', 'danny  test');
select tests.expect_error($q$ insert into public.training_class_attendees (class_id, person_name) values ('cccccccc-0000-0000-ac74-000000000001', 'Lee Hand') $q$, 'full');
select tests.expect_error($q$ insert into public.training_class_attendees (class_id, person_name) values ('cccccccc-0000-0000-ac74-000000000003', 'Danny Test') $q$, 'training_attendees_once');
select tests.expect_error($q$ insert into public.training_class_attendees (class_id, person_name, status) values ('cccccccc-0000-0000-ac74-000000000002', 'Lee Hand', 'attended') $q$, 'booked first');
insert into public.training_class_attendees (id, class_id, person_name) values ('eeeeeeee-0000-0000-ac74-000000000003', 'cccccccc-0000-0000-ac74-000000000002', 'Lee Hand');
select tests.expect_error($q$ update public.training_class_attendees set status = 'attended' where id = 'eeeeeeee-0000-0000-ac74-000000000003' $q$, 'once it has started');
-- Danny attended, competent, hours from the class's clocks.
update public.training_class_attendees set status = 'attended', result = 'pass' where id = 'eeeeeeee-0000-0000-ac74-000000000001';
-- Sam attended, not yet competent, hours as given.
update public.training_class_attendees set status = 'attended', result = 'fail', hours = 3 where id = 'eeeeeeee-0000-0000-ac74-000000000002';
do $$ declare r record; begin
  select * into r from public.training_class_attendees where id = 'eeeeeeee-0000-0000-ac74-000000000001';
  assert r.person_name = 'Danny Test' and r.status = 'attended' and r.hours = 4.5 and r.result = 'pass' and r.marked_at is not null and r.marked_by = '00000000-0000-0000-ac74-000000000001', 'attended with the class''s hours, stamped: ' || row_to_json(r)::text;
  select * into r from public.training_class_attendees where id = 'eeeeeeee-0000-0000-ac74-000000000002';
  assert r.hours = 3, 'hours given are kept';
end $$;
select tests.expect_error($q$ update public.training_class_attendees set result = 'pass' where id = 'eeeeeeee-0000-0000-ac74-000000000002' $q$, 'frozen');
select tests.expect_error($q$ update public.training_class_attendees set status = 'booked' where id = 'eeeeeeee-0000-0000-ac74-000000000001' $q$, 'frozen');
-- The induction class with no end: the course's two hours.
update public.training_class_attendees set status = 'attended' where id = 'eeeeeeee-0000-0000-ac74-000000000004';
do $$ declare r record; begin
  select * into r from public.training_class_attendees where id = 'eeeeeeee-0000-0000-ac74-000000000004';
  assert r.hours = 2 and r.result is null, 'hours from the course when the class has no end: ' || row_to_json(r)::text;
end $$;
-- Withdrawn frees the seat; absent carries no hours.
update public.training_class_attendees set status = 'withdrawn' where id = 'eeeeeeee-0000-0000-ac74-000000000003';
insert into public.training_class_attendees (id, class_id, person_name) values ('eeeeeeee-0000-0000-ac74-000000000005', 'cccccccc-0000-0000-ac74-000000000002', 'Sam Test');
update public.training_class_attendees set status = 'absent', hours = 5 where id = 'eeeeeeee-0000-0000-ac74-000000000005';
do $$ declare r record; begin
  select * into r from public.training_class_attendees where id = 'eeeeeeee-0000-0000-ac74-000000000005';
  assert r.status = 'absent' and r.hours is null and r.marked_at is not null, 'absent carries no hours: ' || row_to_json(r)::text;
end $$;
-- The class is marked held once run; then frozen.
update public.training_classes set status = 'held' where id = 'cccccccc-0000-0000-ac74-000000000001';
select tests.expect_error($q$ update public.training_classes set venue = 'Moved' where id = 'cccccccc-0000-0000-ac74-000000000001' $q$, 'frozen');
-- A cancelled class takes no booking.
update public.training_classes set status = 'cancelled', cancelled_reason = 'Trainer unavailable' where id = 'cccccccc-0000-0000-ac74-000000000002';
select tests.expect_error($q$ insert into public.training_class_attendees (class_id, person_name) values ('cccccccc-0000-0000-ac74-000000000002', 'Nobody') $q$, 'cancelled');
do $$ declare r record; begin
  select * into r from public.training_classes where id = 'cccccccc-0000-0000-ac74-000000000001';
  assert r.held_at is not null, 'held is stamped';
  select * into r from public.training_classes where id = 'cccccccc-0000-0000-ac74-000000000002';
  assert r.cancelled_at is not null, 'cancelled is stamped';
end $$;
reset role;
select tests.expect_error($q$ delete from public.training_class_attendees where id = 'eeeeeeee-0000-0000-ac74-000000000005' $q$, 'never deleted');
do $$ begin raise notice 'PASS  3 bookings are one per person, seat-limited, marked once the class ran, hours from the clocks or the course, frozen'; end $$;

-- 4. The ticket: recorded from an attendance marked competent, of this person, for the competency the course
--    earns, dated the class's Perth day and expiring by the course's months; once per attendance.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-ac74-000000000001","role":"authenticated"}', true);
set local role authenticated;
select tests.expect_error($q$ insert into public.crew_tickets (org_id, person_name, ticket_type, class_attendee_id) values ('aaaaaaaa-0000-0000-ac74-000000000001', 'Sam Test', 'excavator', 'eeeeeeee-0000-0000-ac74-000000000002') $q$, 'marked competent');
select tests.expect_error($q$ insert into public.crew_tickets (org_id, person_name, ticket_type, class_attendee_id) values ('aaaaaaaa-0000-0000-ac74-000000000001', 'Danny Test', 'roller', 'eeeeeeee-0000-0000-ac74-000000000001') $q$, 'does not earn this ticket');
select tests.expect_error($q$ insert into public.crew_tickets (org_id, person_name, ticket_type, class_attendee_id) values ('aaaaaaaa-0000-0000-ac74-000000000001', 'Someone Else', 'excavator', 'eeeeeeee-0000-0000-ac74-000000000001') $q$, 'names the person who attended');
select tests.expect_error($q$ insert into public.crew_tickets (org_id, person_name, ticket_type, class_attendee_id) values ('aaaaaaaa-0000-0000-ac74-000000000001', 'Danny Test', 'site_induction', 'eeeeeeee-0000-0000-ac74-000000000004') $q$, 'marked competent');
insert into public.crew_tickets (id, org_id, person_name, ticket_type, class_attendee_id) values
  ('ffffffff-0000-0000-ac74-000000000001', 'aaaaaaaa-0000-0000-ac74-000000000001', 'danny test', 'excavator', 'eeeeeeee-0000-0000-ac74-000000000001');
do $$ declare r record; begin
  select * into r from public.crew_tickets where id = 'ffffffff-0000-0000-ac74-000000000001';
  assert r.issued_on = date '2026-10-06', 'issued the class''s Perth day (07:00 on the 6th, 23:00 UTC on the 5th): ' || r.issued_on;
  assert r.expires_on = date '2029-10-06', 'expires 36 months on: ' || r.expires_on;
end $$;
select tests.expect_error($q$ insert into public.crew_tickets (org_id, person_name, ticket_type, class_attendee_id) values ('aaaaaaaa-0000-0000-ac74-000000000001', 'Danny Test', 'excavator', 'eeeeeeee-0000-0000-ac74-000000000001') $q$, 'crew_tickets_class_once');
reset role;
-- Another company cannot pin a ticket on this attendance.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-ac74-000000000006","role":"authenticated"}', true);
set local role authenticated;
select tests.expect_error($q$ insert into public.crew_tickets (org_id, person_name, ticket_type, class_attendee_id) values ('aaaaaaaa-0000-0000-ac74-000000000002', 'Danny Test', 'excavator', 'eeeeeeee-0000-0000-ac74-000000000001') $q$, 'another company');
reset role;
do $$ begin raise notice 'PASS  4 a ticket stands on a competent attendance, of the person, for the course''s competency, once, dated the class''s day'; end $$;

-- 5. Reads: the leading hand reads; the labourer reads none; the other company sees nothing of ours.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-ac74-000000000002","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  assert (select count(*) from public.training_courses) = 2, 'the leading hand reads the courses';
  assert (select count(*) from public.training_classes) = 3, 'the leading hand reads the classes';
  assert (select count(*) from public.training_class_attendees) = 5, 'the leading hand reads the bookings';
end $$;
select tests.expect_error($q$ insert into public.training_class_attendees (class_id, person_name) values ('cccccccc-0000-0000-ac74-000000000003', 'Lee Hand') $q$, 'row-level security');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-ac74-000000000003","role":"authenticated"}', true);
do $$ begin
  assert (select count(*) from public.training_courses) = 0, 'the labourer reads courses';
  assert (select count(*) from public.training_classes) = 0, 'the labourer reads classes';
  assert (select count(*) from public.training_class_attendees) = 0, 'the labourer reads bookings';
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-ac74-000000000006","role":"authenticated"}', true);
do $$ begin
  assert (select count(*) from public.training_courses where org_id = 'aaaaaaaa-0000-0000-ac74-000000000001') = 0, 'another company reads our courses';
  assert (select count(*) from public.training_class_attendees) = 0, 'another company reads our bookings';
end $$;
reset role;
do $$ begin raise notice 'PASS  5 the leading hand reads, the labourer and the other company read none'; end $$;

rollback;
