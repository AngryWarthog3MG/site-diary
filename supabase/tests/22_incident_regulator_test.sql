-- The WorkSafe trail on a notifiable incident: who writes it, what each step must carry, and that it stands.
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
  ('11111111-1111-1111-1111-111111111111', 'sup@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'lh@example.com'),
  ('55555555-5555-5555-5555-555555555555', 'lab@example.com');
insert into public.profiles (id, email, full_name) values
  ('11111111-1111-1111-1111-111111111111', 'sup@example.com', 'Sue Pervisor'),
  ('22222222-2222-2222-2222-222222222222', 'lh@example.com', 'Lee Hand'),
  ('55555555-5555-5555-5555-555555555555', 'lab@example.com', 'Sam Labourer')
  on conflict (id) do nothing;
insert into public.organisations (id, name, code) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Kingsbridge Civil', 'KBS');
insert into public.projects (id, org_id, name, code) values ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Northern', 'C001');
insert into public.project_members (project_id, user_id, role) values
  ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'supervisor'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'leading_hand'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '55555555-5555-5555-5555-555555555555', 'labourer');

select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;
insert into public.incidents (id, project_id, kind, occurred_at, description, notifiable, reported_by)
values ('dddddddd-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'injury', now() - interval '2 hours',
        'Trench wall slumped, worker taken to hospital', true, '11111111-1111-1111-1111-111111111111');

-- The supervisor records the steps. Who recorded each is stamped by the database.
insert into public.incident_regulator_events (id, incident_id, kind, happened_at, created_by)
values ('eeeeeeee-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001', 'became_aware', now() - interval '100 minutes',
        '22222222-2222-2222-2222-222222222222');
insert into public.incident_regulator_events (incident_id, kind, happened_at, method, person_name, detail)
values ('dddddddd-0000-0000-0000-000000000001', 'notified', now() - interval '80 minutes', 'phone', '  Sue Pervisor ', '   ');
insert into public.incident_regulator_events (incident_id, kind, happened_at, person_name)
values ('dddddddd-0000-0000-0000-000000000001', 'site_preserved', now() - interval '95 minutes', 'Georgiou Group (principal contractor)');
do $$ begin
  assert (select created_by from public.incident_regulator_events where id = 'eeeeeeee-0000-0000-0000-000000000001') = '11111111-1111-1111-1111-111111111111',
    'the client chose who recorded the step';
  assert (select person_name from public.incident_regulator_events where kind = 'notified') = 'Sue Pervisor', 'the name was not trimmed';
  assert (select detail from public.incident_regulator_events where kind = 'notified') is null, 'a blank detail was stored as blank rather than null';
  raise notice 'PASS  a supervisor records the trail, stamped by the database';
end $$;

-- Each step must carry what makes it evidence.
select tests.expect_error($q$
  insert into public.incident_regulator_events (incident_id, kind, happened_at)
  values ('dddddddd-0000-0000-0000-000000000001', 'notified', now())
$q$, 'how worksafe was told');
select tests.expect_error($q$
  insert into public.incident_regulator_events (incident_id, kind, happened_at, person_name)
  values ('dddddddd-0000-0000-0000-000000000001', 'site_preserved', now(), '   ')
$q$, 'management or control');
select tests.expect_error($q$
  insert into public.incident_regulator_events (incident_id, kind, happened_at)
  values ('dddddddd-0000-0000-0000-000000000001', 'written_notice_given', now() + interval '1 day')
$q$, 'in the future');
select tests.expect_error($q$
  insert into public.incident_regulator_events (incident_id, kind, happened_at)
  values ('dddddddd-0000-0000-0000-000000000001', 'phoned_a_friend', now())
$q$, 'check constraint');
do $$ begin raise notice 'PASS  a notification needs its method, preservation its duty-holder, and nothing is in the future'; end $$;

-- A recorded step stands: an update or delete reaches no row, and the time is unchanged.
update public.incident_regulator_events set happened_at = now() - interval '10 minutes' where id = 'eeeeeeee-0000-0000-0000-000000000001';
delete from public.incident_regulator_events where id = 'eeeeeeee-0000-0000-0000-000000000001';
do $$ begin
  assert (select count(*) from public.incident_regulator_events where id = 'eeeeeeee-0000-0000-0000-000000000001') = 1, 'a step was deleted';
  assert (select happened_at from public.incident_regulator_events where id = 'eeeeeeee-0000-0000-0000-000000000001') < now() - interval '90 minutes',
    'a step was re-timed';
  raise notice 'PASS  a recorded step is never re-timed or removed';
end $$;

-- The service role, which bypasses row security, is stopped by the freeze trigger itself.
reset role;
select tests.expect_error($q$
  delete from public.incident_regulator_events where id = 'eeeeeeee-0000-0000-0000-000000000001'
$q$, 'never changed or removed');

-- A leading hand reads the trail but does not deal with the regulator on the business's behalf.
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  assert (select count(*) from public.incident_regulator_events) = 3, 'a leading hand cannot read the trail';
end $$;
select tests.expect_error($q$
  insert into public.incident_regulator_events (incident_id, kind, happened_at)
  values ('dddddddd-0000-0000-0000-000000000001', 'became_aware', now())
$q$, 'row-level security');
do $$ begin raise notice 'PASS  a leading hand reads the trail and cannot add to it'; end $$;

-- A labourer, who reports hazards but does not read the record, sees none of it.
reset role;
select set_config('request.jwt.claims', '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  assert (select count(*) from public.incident_regulator_events) = 0, 'a labourer read the WorkSafe trail';
  -- README R75: a labourer reads only the reports they made; this one is the supervisor's.
  assert (select count(*) from public.incidents) = 0, 'a labourer read a report they did not make';
  raise notice 'PASS  a labourer reads neither someone else''s report nor the WorkSafe trail';
end $$;

reset role;
select set_config('request.jwt.claims', '', true);
do $$ begin raise notice 'ALL REGULATOR TESTS PASSED'; end $$;
rollback;
