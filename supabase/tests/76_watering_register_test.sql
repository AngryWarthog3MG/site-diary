-- The watering register (README R190): the office keeps a job's areas; whoever runs the site records a day — the
-- maximum temperature, and per area a method and hours, supplementary watering beside it, a note; a method may wait
-- for its hours, hours never stand without a method; nothing is recorded ahead of the day; a week closes once it is
-- over with no hours outstanding, and then nothing in it changes; nothing is deleted; the labourer and another job
-- read none.
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
-- The Monday of last week (a week that is over), and today, both Perth's.
create function tests.wk() returns date language sql stable as $$ select date_trunc('week', (now() at time zone 'Australia/Perth'))::date - 7 $$;
create function tests.today() returns date language sql stable as $$ select (now() at time zone 'Australia/Perth')::date $$;

insert into auth.users (id, email) values
  ('11111111-7676-0000-0000-000000000001', 'pm.water@example.com'),
  ('11111111-7676-0000-0000-000000000002', 'sup.water@example.com'),
  ('11111111-7676-0000-0000-000000000003', 'lh.water@example.com'),
  ('11111111-7676-0000-0000-000000000004', 'lab.water@example.com'),
  ('11111111-7676-0000-0000-000000000005', 'other.water@example.com');
insert into public.organisations (id, name, code) values ('aaaaaaaa-7676-0000-0000-000000000001', 'Watering Civil', 'WTC');
insert into public.projects (id, org_id, name, code) values
  ('bbbbbbbb-7676-0000-0000-000000000001', 'aaaaaaaa-7676-0000-0000-000000000001', 'Watering Job', 'W761'),
  ('bbbbbbbb-7676-0000-0000-000000000002', 'aaaaaaaa-7676-0000-0000-000000000001', 'Other Job', 'W762');
insert into public.project_members (project_id, user_id, role) values
  ('bbbbbbbb-7676-0000-0000-000000000001', '11111111-7676-0000-0000-000000000001', 'pm'),
  ('bbbbbbbb-7676-0000-0000-000000000001', '11111111-7676-0000-0000-000000000002', 'supervisor'),
  ('bbbbbbbb-7676-0000-0000-000000000001', '11111111-7676-0000-0000-000000000003', 'leading_hand'),
  ('bbbbbbbb-7676-0000-0000-000000000001', '11111111-7676-0000-0000-000000000004', 'labourer'),
  ('bbbbbbbb-7676-0000-0000-000000000002', '11111111-7676-0000-0000-000000000005', 'pm');
set local role authenticated;

-- 1. The office keeps the areas: tidied, one of a name, never deleted; the site does not add them.
set local request.jwt.claims = '{"sub":"11111111-7676-0000-0000-000000000001","role":"authenticated"}';
insert into public.watering_areas (id, project_id, name, sort_order) values
  ('cccccccc-7676-0000-0000-000000000001', 'bbbbbbbb-7676-0000-0000-000000000001', '  East   Gate ', 1),
  ('cccccccc-7676-0000-0000-000000000002', 'bbbbbbbb-7676-0000-0000-000000000001', 'Bus Port', 2),
  ('cccccccc-7676-0000-0000-000000000003', 'bbbbbbbb-7676-0000-0000-000000000001', 'Old Bed', 3);
do $$ begin
  if (select name from public.watering_areas where id = 'cccccccc-7676-0000-0000-000000000001') <> 'East Gate' then raise exception 'TESTFAIL: the name is tidied'; end if;
  if (select created_by from public.watering_areas where id = 'cccccccc-7676-0000-0000-000000000001') <> '11111111-7676-0000-0000-000000000001' then raise exception 'TESTFAIL: created_by is the caller'; end if;
end; $$;
select tests.expect_error($$ insert into public.watering_areas (project_id, name) values ('bbbbbbbb-7676-0000-0000-000000000001', 'east gate') $$, 'watering_areas_name_once');
select tests.expect_error($$ insert into public.watering_areas (project_id, name) values ('bbbbbbbb-7676-0000-0000-000000000001', '   ') $$, 'needs a name');
-- No delete policy: under RLS a delete takes nothing (the trigger's refusal is proved at the end, without RLS).
delete from public.watering_areas where id = 'cccccccc-7676-0000-0000-000000000002';
do $$ begin if not exists (select 1 from public.watering_areas where id = 'cccccccc-7676-0000-0000-000000000002') then raise exception 'TESTFAIL: an area was deleted'; end if; end $$;
update public.watering_areas set active = false where id = 'cccccccc-7676-0000-0000-000000000003';
set local request.jwt.claims = '{"sub":"11111111-7676-0000-0000-000000000002","role":"authenticated"}';
select tests.expect_error($$ insert into public.watering_areas (project_id, name) values ('bbbbbbbb-7676-0000-0000-000000000001', 'Supervisor''s bed') $$, 'row-level security');
update public.watering_areas set name = 'Renamed by the site' where id = 'cccccccc-7676-0000-0000-000000000002';
do $$ begin
  if (select name from public.watering_areas where id = 'cccccccc-7676-0000-0000-000000000002') <> 'Bus Port' then raise exception 'TESTFAIL: the site renamed an area'; end if;
end; $$;
do $$ begin raise notice 'PASS  1 the office keeps the areas; tidied, one of a name, never deleted'; end $$;

-- 2. The leading hand records a day: the temperature, and per area the watering, supplementary beside it, a note.
set local request.jwt.claims = '{"sub":"11111111-7676-0000-0000-000000000003","role":"authenticated"}';
insert into public.watering_days (project_id, day, temp_max) values ('bbbbbbbb-7676-0000-0000-000000000001', tests.wk(), 36.4);
insert into public.watering_entries (project_id, area_id, day, method, hours, supp_method, supp_hours, notes) values
  ('bbbbbbbb-7676-0000-0000-000000000001', 'cccccccc-7676-0000-0000-000000000001', tests.wk(), 'irrigation', 2, 'manual', 0.5, '  Sprinkler head   broken near the gate '),
  ('bbbbbbbb-7676-0000-0000-000000000001', 'cccccccc-7676-0000-0000-000000000002', tests.wk(), 'soaker', null, null, null, null);
do $$
declare e public.watering_entries; d public.watering_days;
begin
  select * into e from public.watering_entries where area_id = 'cccccccc-7676-0000-0000-000000000001' and day = tests.wk();
  if e.notes <> 'Sprinkler head broken near the gate' or e.hours <> 2 or e.supp_hours <> 0.5 then raise exception 'TESTFAIL: the line as recorded: %', row_to_json(e)::text; end if;
  if e.created_by <> '11111111-7676-0000-0000-000000000003' or e.updated_by <> e.created_by then raise exception 'TESTFAIL: stamped with the leading hand'; end if;
  select * into d from public.watering_days where project_id = 'bbbbbbbb-7676-0000-0000-000000000001' and day = tests.wk();
  if d.temp_max <> 36.4 or d.recorded_by <> '11111111-7676-0000-0000-000000000003' then raise exception 'TESTFAIL: the day as recorded'; end if;
  if (select hours from public.watering_entries where area_id = 'cccccccc-7676-0000-0000-000000000002' and day = tests.wk()) is not null then raise exception 'TESTFAIL: a method may wait for its hours'; end if;
end; $$;
select tests.expect_error($$ insert into public.watering_entries (project_id, area_id, day, hours) values ('bbbbbbbb-7676-0000-0000-000000000001', 'cccccccc-7676-0000-0000-000000000001', tests.wk() + 1, 2) $$, 'watering_entries_hours_need_method');
select tests.expect_error($$ insert into public.watering_entries (project_id, area_id, day, method, supp_hours) values ('bbbbbbbb-7676-0000-0000-000000000001', 'cccccccc-7676-0000-0000-000000000001', tests.wk() + 1, 'irrigation', 1) $$, 'watering_entries_supp_hours_need_method');
select tests.expect_error($$ insert into public.watering_entries (project_id, area_id, day, method, hours) values ('bbbbbbbb-7676-0000-0000-000000000001', 'cccccccc-7676-0000-0000-000000000001', tests.wk() + 1, 'irrigation', 25) $$, 'check constraint');
select tests.expect_error($$ insert into public.watering_entries (project_id, area_id, day, method, hours) values ('bbbbbbbb-7676-0000-0000-000000000001', 'cccccccc-7676-0000-0000-000000000001', tests.wk() + 1, 'irrigation', 0) $$, 'check constraint');
select tests.expect_error($$ insert into public.watering_entries (project_id, area_id, day, method, hours) values ('bbbbbbbb-7676-0000-0000-000000000001', 'cccccccc-7676-0000-0000-000000000001', tests.wk() + 1, 'sprinkler', 1) $$, 'check constraint');
select tests.expect_error($$ insert into public.watering_entries (project_id, area_id, day, method, hours) values ('bbbbbbbb-7676-0000-0000-000000000001', 'cccccccc-7676-0000-0000-000000000001', tests.wk(), 'manual', 1) $$, 'watering_entries_once');
select tests.expect_error($$ insert into public.watering_entries (project_id, area_id, day, method, hours) values ('bbbbbbbb-7676-0000-0000-000000000001', 'cccccccc-7676-0000-0000-000000000001', tests.today() + 1, 'irrigation', 1) $$, 'a day that has come');
select tests.expect_error($$ insert into public.watering_days (project_id, day, temp_max) values ('bbbbbbbb-7676-0000-0000-000000000001', tests.today() + 1, 30) $$, 'a day that has come');
select tests.expect_error($$ insert into public.watering_days (project_id, day, temp_max) values ('bbbbbbbb-7676-0000-0000-000000000001', tests.wk() + 1, 75) $$, 'check constraint');
select tests.expect_error($$ insert into public.watering_entries (project_id, area_id, day, method, hours) values ('bbbbbbbb-7676-0000-0000-000000000001', 'cccccccc-7676-0000-0000-000000000003', tests.wk(), 'irrigation', 1) $$, 'retired');
select tests.expect_error($$ insert into public.watering_entries (project_id, area_id, day, method, hours) values ('bbbbbbbb-7676-0000-0000-000000000002', 'cccccccc-7676-0000-0000-000000000001', tests.wk(), 'irrigation', 1) $$, 'one of this job');
delete from public.watering_entries where day = tests.wk();
do $$ begin if (select count(*) from public.watering_entries where day = tests.wk()) <> 2 then raise exception 'TESTFAIL: a watering line was deleted'; end if; end $$;
do $$ begin raise notice 'PASS  2 a day recorded: temperature, method and hours, supplementary, a note; hours never without a method; nothing ahead of the day'; end $$;

-- 3. Saving the day again as it stands is not a change; a real change is stamped with whoever made it.
set local request.jwt.claims = '{"sub":"11111111-7676-0000-0000-000000000002","role":"authenticated"}';
insert into public.watering_entries (project_id, area_id, day, method, hours, supp_method, supp_hours, notes)
values ('bbbbbbbb-7676-0000-0000-000000000001', 'cccccccc-7676-0000-0000-000000000001', tests.wk(), 'irrigation', 2, 'manual', 0.5, 'Sprinkler head broken near the gate')
on conflict (area_id, day) do update set method = excluded.method, hours = excluded.hours, supp_method = excluded.supp_method, supp_hours = excluded.supp_hours, notes = excluded.notes;
insert into public.watering_days (project_id, day, temp_max) values ('bbbbbbbb-7676-0000-0000-000000000001', tests.wk(), 36.4)
on conflict (project_id, day) do update set temp_max = excluded.temp_max;
do $$ begin
  if (select updated_by from public.watering_entries where area_id = 'cccccccc-7676-0000-0000-000000000001' and day = tests.wk()) <> '11111111-7676-0000-0000-000000000003' then raise exception 'TESTFAIL: an unchanged save restamped the line'; end if;
  if (select updated_by from public.watering_days where project_id = 'bbbbbbbb-7676-0000-0000-000000000001' and day = tests.wk()) <> '11111111-7676-0000-0000-000000000003' then raise exception 'TESTFAIL: an unchanged save restamped the day'; end if;
end; $$;
update public.watering_entries set supp_hours = 1 where area_id = 'cccccccc-7676-0000-0000-000000000001' and day = tests.wk();
update public.watering_days set temp_max = 37.1 where project_id = 'bbbbbbbb-7676-0000-0000-000000000001' and day = tests.wk();
do $$ begin
  if (select updated_by from public.watering_entries where area_id = 'cccccccc-7676-0000-0000-000000000001' and day = tests.wk()) <> '11111111-7676-0000-0000-000000000002' then raise exception 'TESTFAIL: a change is stamped with who made it'; end if;
  if (select created_by from public.watering_entries where area_id = 'cccccccc-7676-0000-0000-000000000001' and day = tests.wk()) <> '11111111-7676-0000-0000-000000000003' then raise exception 'TESTFAIL: created_by stays'; end if;
  if (select recorded_by from public.watering_days where project_id = 'bbbbbbbb-7676-0000-0000-000000000001' and day = tests.wk()) <> '11111111-7676-0000-0000-000000000003' then raise exception 'TESTFAIL: recorded_by stays'; end if;
  if (select updated_by from public.watering_days where project_id = 'bbbbbbbb-7676-0000-0000-000000000001' and day = tests.wk()) <> '11111111-7676-0000-0000-000000000002' then raise exception 'TESTFAIL: the temperature change is stamped'; end if;
end; $$;
select tests.expect_error($$ update public.watering_entries set day = tests.wk() + 2 where area_id = 'cccccccc-7676-0000-0000-000000000001' and day = tests.wk() $$, 'stays on its area and its day');
do $$ begin raise notice 'PASS  3 an unchanged save is not a change; a change is stamped'; end $$;

-- 4. The labourer reads none and records none; another job reads none.
set local request.jwt.claims = '{"sub":"11111111-7676-0000-0000-000000000004","role":"authenticated"}';
do $$ begin
  if (select count(*) from public.watering_areas) <> 0 or (select count(*) from public.watering_entries) <> 0 or (select count(*) from public.watering_days) <> 0 then raise exception 'TESTFAIL: the labourer reads the register'; end if;
end; $$;
select tests.expect_error($$ insert into public.watering_entries (project_id, area_id, day, method, hours) values ('bbbbbbbb-7676-0000-0000-000000000001', 'cccccccc-7676-0000-0000-000000000002', tests.wk() + 1, 'manual', 1) $$, 'row-level security');
set local request.jwt.claims = '{"sub":"11111111-7676-0000-0000-000000000005","role":"authenticated"}';
do $$ begin
  if (select count(*) from public.watering_areas) <> 0 or (select count(*) from public.watering_entries) <> 0 then raise exception 'TESTFAIL: another job reads the register'; end if;
end; $$;
do $$ begin raise notice 'PASS  4 the labourer and another job read none'; end $$;

-- 5. Closing: a supervisor's, once the week is over and no hours are outstanding; then nothing in it changes.
set local request.jwt.claims = '{"sub":"11111111-7676-0000-0000-000000000002","role":"authenticated"}';
select tests.expect_error($$ insert into public.watering_weeks (project_id, week_start) values ('bbbbbbbb-7676-0000-0000-000000000001', tests.wk() + 7) $$, 'once it is over');
select tests.expect_error($$ insert into public.watering_weeks (project_id, week_start) values ('bbbbbbbb-7676-0000-0000-000000000001', tests.wk() + 1) $$, 'check constraint');
select tests.expect_error($$ insert into public.watering_weeks (project_id, week_start) values ('bbbbbbbb-7676-0000-0000-000000000001', tests.wk()) $$, 'still need their hours');
update public.watering_entries set hours = 4.5 where area_id = 'cccccccc-7676-0000-0000-000000000002' and day = tests.wk();
-- The leading hand records the watering but does not close the week.
set local request.jwt.claims = '{"sub":"11111111-7676-0000-0000-000000000003","role":"authenticated"}';
select tests.expect_error($$ insert into public.watering_weeks (project_id, week_start) values ('bbbbbbbb-7676-0000-0000-000000000001', tests.wk()) $$, 'row-level security');
set local request.jwt.claims = '{"sub":"11111111-7676-0000-0000-000000000002","role":"authenticated"}';
insert into public.watering_weeks (project_id, week_start) values ('bbbbbbbb-7676-0000-0000-000000000001', tests.wk());
do $$ begin
  if (select closed_by from public.watering_weeks where project_id = 'bbbbbbbb-7676-0000-0000-000000000001' and week_start = tests.wk()) <> '11111111-7676-0000-0000-000000000002' then raise exception 'TESTFAIL: closed_by is the caller'; end if;
end; $$;
select tests.expect_error($$ update public.watering_entries set hours = 3 where area_id = 'cccccccc-7676-0000-0000-000000000001' and day = tests.wk() $$, 'closed');
select tests.expect_error($$ update public.watering_days set temp_max = 30 where project_id = 'bbbbbbbb-7676-0000-0000-000000000001' and day = tests.wk() $$, 'closed');
select tests.expect_error($$ insert into public.watering_entries (project_id, area_id, day, method, hours) values ('bbbbbbbb-7676-0000-0000-000000000001', 'cccccccc-7676-0000-0000-000000000001', tests.wk() + 3, 'manual', 1) $$, 'closed');
select tests.expect_error($$ insert into public.watering_days (project_id, day) values ('bbbbbbbb-7676-0000-0000-000000000001', tests.wk() + 3) $$, 'closed');
-- The same line saved again as it stands is still not a change, closed or not: a late replay from a phone does no harm.
update public.watering_entries set hours = 2 where area_id = 'cccccccc-7676-0000-0000-000000000001' and day = tests.wk();
-- This week is still open.
insert into public.watering_entries (project_id, area_id, day, method, hours) values ('bbbbbbbb-7676-0000-0000-000000000001', 'cccccccc-7676-0000-0000-000000000001', tests.today(), 'manual', 0.75);
reset role;
select tests.expect_error($$ delete from public.watering_weeks where project_id = 'bbbbbbbb-7676-0000-0000-000000000001' $$, 'never changed or removed');
select tests.expect_error($$ update public.watering_weeks set closed_at = now() where project_id = 'bbbbbbbb-7676-0000-0000-000000000001' $$, 'never changed or removed');
select tests.expect_error($$ delete from public.watering_entries where project_id = 'bbbbbbbb-7676-0000-0000-000000000001' $$, 'never changed or removed');
select tests.expect_error($$ delete from public.watering_days where project_id = 'bbbbbbbb-7676-0000-0000-000000000001' $$, 'never changed or removed');
select tests.expect_error($$ delete from public.watering_areas where project_id = 'bbbbbbbb-7676-0000-0000-000000000001' $$, 'never changed or removed');
do $$ begin raise notice 'PASS  5 a week closes once over with no hours outstanding; then frozen; nothing deleted'; end $$;

rollback;
