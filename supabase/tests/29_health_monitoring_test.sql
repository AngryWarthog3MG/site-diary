-- Health monitoring: the confidentiality tier. Records and report files are for named keepers only — an admin who is
-- not a keeper reads nothing — records are kept 30 years (40 for asbestos), and lead risk work is notified within 7 days.
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
  ('44444444-4444-4444-4444-444444444444', 'admin@example.com'),
  ('66666666-6666-6666-6666-666666666666', 'keeper@example.com'),
  ('11111111-1111-1111-1111-111111111111', 'sup@example.com');
insert into public.organisations (id, name, code) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Kingsbridge Civil', 'KBS');
insert into public.projects (id, org_id, name, code) values ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Northern', 'C001');
insert into public.project_members (project_id, user_id, role) values
  ('bbbbbbbb-0000-0000-0000-000000000001', '44444444-4444-4444-4444-444444444444', 'admin'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '66666666-6666-6666-6666-666666666666', 'pm'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'supervisor');

-- The admin sets up a programme and appoints a keeper — but is not one.
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
set local role authenticated;
insert into public.health_monitoring_programs (id, org_id, hazard, basis, frequency_months, practitioner)
values ('c0000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Lead (sandblasting old bridge paint)', 'lead_risk_work', 6, 'Dr A. Nguyen'),
       ('c0000000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'Asbestos (licensed removal crew)', 'asbestos', 12, 'Dr A. Nguyen');
insert into public.health_record_keepers (org_id, user_id) values ('aaaaaaaa-0000-0000-0000-000000000001', '66666666-6666-6666-6666-666666666666');
select tests.expect_error($q$
  insert into public.health_monitoring_records (program_id, person_name, monitored_on, practitioner) values ('c0000000-0000-0000-0000-000000000001', 'X', current_date, 'Dr')
$q$, 'row-level security');
do $$ begin raise notice 'PASS  an admin appoints a keeper and sets up programmes, but cannot write a record'; end $$;

-- The keeper records monitoring.
reset role;
select set_config('request.jwt.claims', '{"sub":"66666666-6666-6666-6666-666666666666","role":"authenticated"}', true);
set local role authenticated;
insert into public.health_monitoring_records (id, program_id, person_name, monitored_on, practitioner, result_summary, next_due_on, report_file_path)
values ('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', ' Evan  Burke ', '2026-09-01', 'Dr A. Nguyen', 'Blood lead 12 µg/dL', '2027-03-01',
        'aaaaaaaa-0000-0000-0000-000000000001/c0000000-0000-0000-0000-000000000001/d0000000-0000-0000-0000-000000000001.pdf'),
       ('d0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002', 'Marcus Hayden', '2026-09-01', 'Dr A. Nguyen', 'Chest X-ray clear', null, null);
do $$ begin
  assert (select retain_until from public.health_monitoring_records where id = 'd0000000-0000-0000-0000-000000000001') = '2056-09-01', 'lead record not kept 30 years';
  assert (select retain_until from public.health_monitoring_records where id = 'd0000000-0000-0000-0000-000000000002') = '2066-09-01', 'asbestos record not kept 40 years';
  assert (select person_name from public.health_monitoring_records where id = 'd0000000-0000-0000-0000-000000000001') = 'Evan Burke', 'name not tidied';
  assert (select count(*) from public.health_monitoring_records) = 2, 'the keeper cannot read the records';
  raise notice 'PASS  a keeper records monitoring, kept 30 years, or 40 for asbestos';
end $$;
update public.health_monitoring_records set result_summary = 'Changed' where id = 'd0000000-0000-0000-0000-000000000001';
do $$ begin
  assert (select result_summary from public.health_monitoring_records where id = 'd0000000-0000-0000-0000-000000000001') = 'Blood lead 12 µg/dL', 'a report was rewritten';
end $$;

-- THE POINT: the admin who appointed the keeper reads no record. Neither does a supervisor.
reset role;
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  assert (select count(*) from public.health_monitoring_records) = 0, 'an admin who is not a keeper read a health record';
  assert (select count(*) from public.health_monitoring_programs) = 2, 'the admin cannot see the programmes they set up';
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  assert (select count(*) from public.health_monitoring_records) = 0, 'a supervisor read a health record';
  raise notice 'PASS  the admin and a supervisor read no health record — only named keepers do';
end $$;

-- Revoked, the keeper reads nothing more; the revocation is on the record.
reset role;
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
set local role authenticated;
update public.health_record_keepers set active = false where org_id = 'aaaaaaaa-0000-0000-0000-000000000001' and user_id = '66666666-6666-6666-6666-666666666666';
-- A keeper appointment is revoked, never deleted: the delete reaches no row.
delete from public.health_record_keepers where user_id = '66666666-6666-6666-6666-666666666666';
do $$ begin
  assert (select count(*) from public.health_record_keepers where user_id = '66666666-6666-6666-6666-666666666666') = 1, 'a keeper appointment was deleted';
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"66666666-6666-6666-6666-666666666666","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  assert (select count(*) from public.health_monitoring_records) = 0, 'a revoked keeper still reads records';
  assert (select revoked_by from public.health_record_keepers where user_id = '66666666-6666-6666-6666-666666666666') = '44444444-4444-4444-4444-444444444444', 'revocation not stamped';
  raise notice 'PASS  a revoked keeper reads nothing, and who revoked it is recorded';
end $$;

-- Lead risk work notified within 7 days.
reset role;
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
set local role authenticated;
insert into public.lead_risk_notifications (org_id, project_id, description, determined_on, notified_on)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'Removing lead paint from bridge rails', current_date - 5, current_date - 1);
-- README R78: a late notification is recorded with its true date (the screen shows it late), never before the determination.
insert into public.lead_risk_notifications (org_id, description, determined_on, notified_on) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Late', current_date - 12, current_date - 1);
select tests.expect_error($q$
  insert into public.lead_risk_notifications (org_id, description, determined_on, notified_on) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Backwards', current_date - 1, current_date - 3)
$q$, 'lead_notified_not_before_determined');
do $$ begin raise notice 'PASS  a lead notification is recorded with its true date, late or not, but never before the determination'; end $$;

-- ---------------------------------------------------------------- README R78 (second-agent review)
-- Re-appointing the keeper keeps both appointments and the revocation between them.
update public.health_record_keepers set active = true where org_id = 'aaaaaaaa-0000-0000-0000-000000000001' and user_id = '66666666-6666-6666-6666-666666666666';
do $$ begin
  assert (select count(*) from public.health_keeper_events where user_id = '66666666-6666-6666-6666-666666666666') = 3, 'appointed, revoked, appointed again were not all kept';
  assert (select string_agg(kind, ',' order by at, kind) from public.health_keeper_events where user_id = '66666666-6666-6666-6666-666666666666') in ('appointed,revoked,appointed', 'appointed,appointed,revoked'), 'the events are wrong';
  raise notice 'PASS  every appointment and revocation is kept, not just the latest';
end $$;

-- A programme cannot move to another company, even for someone who manages crew in both.
reset role;
insert into public.organisations (id, name, code) values ('aaaaaaaa-0000-0000-0000-000000000002', 'Other Civil', 'OTC');
insert into public.projects (id, org_id, name, code) values ('bbbbbbbb-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000002', 'Other job', 'O001');
insert into public.project_members (project_id, user_id, role) values ('bbbbbbbb-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'supervisor');
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;
select tests.expect_error($q$
  update public.health_monitoring_programs set org_id = 'aaaaaaaa-0000-0000-0000-000000000002' where id = 'c0000000-0000-0000-0000-000000000001'
$q$, 'stays with its company');
update public.health_monitoring_programs set active = false where id = 'c0000000-0000-0000-0000-000000000002';
do $$ begin
  assert (select active_changed_by from public.health_monitoring_programs where id = 'c0000000-0000-0000-0000-000000000002') = '11111111-1111-1111-1111-111111111111', 'retiring a programme was not stamped';
  -- A supervisor reads the programmes and who the keepers are — but still no report.
  assert (select count(*) from public.health_record_keepers) >= 1, 'a supervisor cannot see who the keepers are';
  assert (select count(*) from public.health_monitoring_records) = 0, 'a supervisor read a health record';
  raise notice 'PASS  a programme stays with its company; retiring it is stamped; supervisors see programmes and keepers, never reports';
end $$;

-- The keeper records a person's monitoring as ended.
reset role;
select set_config('request.jwt.claims', '{"sub":"66666666-6666-6666-6666-666666666666","role":"authenticated"}', true);
set local role authenticated;
insert into public.health_monitoring_ended (program_id, person_name, ended_on, reason) values ('c0000000-0000-0000-0000-000000000001', ' evan burke ', current_date, 'Left the company');
do $$ begin
  assert (select person_name from public.health_monitoring_ended) = 'evan burke', 'name not tidied';
  raise notice 'PASS  a keeper records that a person''s monitoring ended';
end $$;

-- A keeper who is no longer on any job of the company reads nothing, keeper row or not.
reset role;
delete from public.project_members where user_id = '66666666-6666-6666-6666-666666666666';
select set_config('request.jwt.claims', '{"sub":"66666666-6666-6666-6666-666666666666","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  assert (select count(*) from public.health_monitoring_records) = 0, 'a keeper who left the company still reads health records';
  assert (select count(*) from public.health_monitoring_ended) = 0, 'a keeper who left the company still reads ended markers';
  raise notice 'PASS  a keeper who has left the company reads nothing';
end $$;

reset role;
select set_config('request.jwt.claims', '', true);
do $$ begin raise notice 'ALL HEALTH MONITORING TESTS PASSED'; end $$;
rollback;
