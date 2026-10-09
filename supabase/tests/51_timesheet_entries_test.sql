-- Time the office adds to the timesheet (README R122): an admin adds a line and removes it once with a reason; the
-- hours are the clocks' arithmetic when clocks are given; nothing in the future, nothing twice, nothing overlapping;
-- a PM reads and writes (R136); a supervisor and a labourer read nothing; nobody edits or deletes.
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
  ('11111111-5151-0000-0000-000000000001', 'admin.te@example.com'),
  ('11111111-5151-0000-0000-000000000002', 'pm.te@example.com'),
  ('11111111-5151-0000-0000-000000000003', 'sup.te@example.com'),
  ('11111111-5151-0000-0000-000000000004', 'lab.te@example.com'),
  ('11111111-5151-0000-0000-000000000005', 'other.te@example.com');
insert into public.organisations (id, name, code) values
  ('aaaaaaaa-5151-0000-0000-000000000001', 'Office Time Civil', 'OTC'),
  ('aaaaaaaa-5151-0000-0000-000000000002', 'Someone Else Civil', 'SEC');
insert into public.projects (id, org_id, name, code) values
  ('bbbbbbbb-5151-0000-0000-000000000001', 'aaaaaaaa-5151-0000-0000-000000000001', 'Office Time Job', 'X551'),
  ('bbbbbbbb-5151-0000-0000-000000000002', 'aaaaaaaa-5151-0000-0000-000000000002', 'Someone Else Job', 'X552');
insert into public.project_members (project_id, user_id, role) values
  ('bbbbbbbb-5151-0000-0000-000000000001', '11111111-5151-0000-0000-000000000001', 'admin'),
  ('bbbbbbbb-5151-0000-0000-000000000001', '11111111-5151-0000-0000-000000000002', 'pm'),
  ('bbbbbbbb-5151-0000-0000-000000000001', '11111111-5151-0000-0000-000000000003', 'supervisor'),
  ('bbbbbbbb-5151-0000-0000-000000000001', '11111111-5151-0000-0000-000000000004', 'labourer'),
  ('bbbbbbbb-5151-0000-0000-000000000002', '11111111-5151-0000-0000-000000000005', 'admin');
set local role authenticated;

-- The admin adds a day at the office by its clocks: the hours are the arithmetic, the name is tidied, the adder stamped.
set local request.jwt.claims = '{"sub":"11111111-5151-0000-0000-000000000001","role":"authenticated"}';
insert into public.timesheet_entries (id, org_id, person_name, work_date, start_time, finish_time, hours)
  values ('cccccccc-5151-0000-0000-000000000001', 'aaaaaaaa-5151-0000-0000-000000000001', '  Evan   Burke ', '2026-09-29', '06:30', '13:00', 99);
do $$
declare r public.timesheet_entries;
begin
  select * into r from public.timesheet_entries where id = 'cccccccc-5151-0000-0000-000000000001';
  if r.hours <> 6.5 then raise exception 'TESTFAIL: hours should be the clocks arithmetic, got %', r.hours; end if;
  if r.person_name <> 'Evan Burke' then raise exception 'TESTFAIL: name not tidied'; end if;
  if r.place <> 'Office' then raise exception 'TESTFAIL: place should default to Office'; end if;
  if r.created_by <> '11111111-5151-0000-0000-000000000001' then raise exception 'TESTFAIL: adder not stamped'; end if;
end; $$;
-- A break comes off.
insert into public.timesheet_entries (org_id, person_name, work_date, start_time, finish_time, break_mins, place)
  values ('aaaaaaaa-5151-0000-0000-000000000001', 'Matthew Rodgers', '2026-09-29', '06:30', '15:00', 30, 'Yard');
do $$ begin if (select hours from public.timesheet_entries where person_name = 'Matthew Rodgers') <> 8 then raise exception 'TESTFAIL: break not taken off'; end if; end; $$;
-- Hours alone, no clocks.
insert into public.timesheet_entries (org_id, person_name, work_date, hours, place, note)
  values ('aaaaaaaa-5151-0000-0000-000000000001', 'Florian', '2026-09-28', 4, 'Training', ' First aid refresher ');
do $$ begin if (select note from public.timesheet_entries where person_name = 'Florian') <> 'First aid refresher' then raise exception 'TESTFAIL: note not tidied'; end if; end; $$;

select tests.expect_error($$ insert into public.timesheet_entries (org_id, person_name, work_date) values ('aaaaaaaa-5151-0000-0000-000000000001', 'AJ', '2026-09-29') $$, 'start and finish, or the hours');
select tests.expect_error($$ insert into public.timesheet_entries (org_id, person_name, work_date, hours) values ('aaaaaaaa-5151-0000-0000-000000000001', 'AJ', (now() at time zone 'Australia/Perth')::date + 1, 8) $$, 'future');
select tests.expect_error($$ insert into public.timesheet_entries (org_id, person_name, work_date, start_time, finish_time) values ('aaaaaaaa-5151-0000-0000-000000000001', 'AJ', '2026-09-29', '13:00', '06:30') $$, 'finish must be after the start');
select tests.expect_error($$ insert into public.timesheet_entries (org_id, person_name, work_date, start_time) values ('aaaaaaaa-5151-0000-0000-000000000001', 'AJ', '2026-09-29', '06:30') $$, 'both the start and the finish');
select tests.expect_error($$ insert into public.timesheet_entries (org_id, person_name, work_date, start_time, finish_time, break_mins) values ('aaaaaaaa-5151-0000-0000-000000000001', 'AJ', '2026-09-29', '06:30', '07:00', 30) $$, 'break is as long');
select tests.expect_error($$ insert into public.timesheet_entries (org_id, person_name, work_date, hours) values ('aaaaaaaa-5151-0000-0000-000000000001', 'AJ', '2026-09-29', 25) $$, 'hours_check');
select tests.expect_error($$ insert into public.timesheet_entries (org_id, person_name, work_date, hours) values ('aaaaaaaa-5151-0000-0000-000000000001', '   ', '2026-09-29', 8) $$, 'person_name');
-- The same line twice, and clocks that overlap a line already there.
select tests.expect_error($$ insert into public.timesheet_entries (org_id, person_name, work_date, start_time, finish_time) values ('aaaaaaaa-5151-0000-0000-000000000001', 'evan burke', '2026-09-29', '06:30', '13:00') $$, 'already has added time');
select tests.expect_error($$ insert into public.timesheet_entries (org_id, person_name, work_date, start_time, finish_time) values ('aaaaaaaa-5151-0000-0000-000000000001', 'Evan Burke', '2026-09-29', '12:00', '16:00') $$, 'already has added time');
select tests.expect_error($$ insert into public.timesheet_entries (org_id, person_name, work_date, hours, place) values ('aaaaaaaa-5151-0000-0000-000000000001', 'florian', '2026-09-28', 4, 'training') $$, 'duplicate key');
-- Straight after, on the same day, is fine.
insert into public.timesheet_entries (org_id, person_name, work_date, start_time, finish_time)
  values ('aaaaaaaa-5151-0000-0000-000000000001', 'Evan Burke', '2026-09-29', '13:00', '15:00');
-- Another company is another company.
select tests.expect_error($$ insert into public.timesheet_entries (org_id, person_name, work_date, hours) values ('aaaaaaaa-5151-0000-0000-000000000002', 'AJ', '2026-09-29', 8) $$, 'row-level security');

-- Not edited, not deleted.
select tests.expect_error($$ update public.timesheet_entries set hours = 10 where id = 'cccccccc-5151-0000-0000-000000000001' $$, 'permission denied');
select tests.expect_error($$ update public.timesheet_entries set person_name = 'Someone' where id = 'cccccccc-5151-0000-0000-000000000001' $$, 'permission denied');
select tests.expect_error($$ delete from public.timesheet_entries where id = 'cccccccc-5151-0000-0000-000000000001' $$, 'permission denied');
select tests.expect_error($$ update public.timesheet_entries set void_reason = '   ' where id = 'cccccccc-5151-0000-0000-000000000001' $$, 'Say why');

-- The PM reads the sheet's lines and adds to them (R136).
set local request.jwt.claims = '{"sub":"11111111-5151-0000-0000-000000000002","role":"authenticated"}';
do $$ begin if (select count(*) from public.timesheet_entries) <> 4 then raise exception 'TESTFAIL: a PM should read the added time'; end if; end; $$;
do $$ begin
  begin
    insert into public.timesheet_entries (org_id, person_name, work_date, hours) values ('aaaaaaaa-5151-0000-0000-000000000001', 'AJ', '2026-09-29', 8);
    raise exception 'ROLLBACKOK';
  exception when others then
    if sqlerrm <> 'ROLLBACKOK' then raise exception 'TESTFAIL: the PM should write here (R136): %', sqlerrm; end if;
  end;
  raise notice 'PASS  a PM adds office time too (R136)';
end $$;
-- Site roles read none of it; nor does another company's admin.
set local request.jwt.claims = '{"sub":"11111111-5151-0000-0000-000000000003","role":"authenticated"}';
do $$ begin if (select count(*) from public.timesheet_entries) <> 0 then raise exception 'TESTFAIL: a supervisor reads added time'; end if; end; $$;
set local request.jwt.claims = '{"sub":"11111111-5151-0000-0000-000000000004","role":"authenticated"}';
do $$ begin if (select count(*) from public.timesheet_entries) <> 0 then raise exception 'TESTFAIL: a labourer reads added time'; end if; end; $$;
set local request.jwt.claims = '{"sub":"11111111-5151-0000-0000-000000000005","role":"authenticated"}';
do $$ begin if (select count(*) from public.timesheet_entries) <> 0 then raise exception 'TESTFAIL: another company reads added time'; end if; end; $$;

-- The admin removes a line: once, with its reason, stamped by the database. Then the right line can be added.
set local request.jwt.claims = '{"sub":"11111111-5151-0000-0000-000000000001","role":"authenticated"}';
update public.timesheet_entries set void_reason = '  Wrong day  ' where id = 'cccccccc-5151-0000-0000-000000000001';
do $$
declare r public.timesheet_entries;
begin
  select * into r from public.timesheet_entries where id = 'cccccccc-5151-0000-0000-000000000001';
  if r.voided_at is null or r.voided_by <> '11111111-5151-0000-0000-000000000001' or r.void_reason <> 'Wrong day' then
    raise exception 'TESTFAIL: removal not stamped';
  end if;
end; $$;
select tests.expect_error($$ update public.timesheet_entries set void_reason = 'Again' where id = 'cccccccc-5151-0000-0000-000000000001' $$, 'already been removed');
insert into public.timesheet_entries (org_id, person_name, work_date, start_time, finish_time)
  values ('aaaaaaaa-5151-0000-0000-000000000001', 'Evan Burke', '2026-09-29', '06:30', '13:00');

-- Not even the service role deletes one, or rewrites it.
reset role;
select tests.expect_error($$ delete from public.timesheet_entries where id = 'cccccccc-5151-0000-0000-000000000001' $$, 'never changed or removed');
select tests.expect_error($$ update public.timesheet_entries set hours = 1 where person_name = 'Florian' $$, 'not edited');
rollback;
