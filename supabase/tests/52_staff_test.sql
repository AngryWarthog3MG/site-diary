-- The company's staff list (README R123): one row per person per company; anyone put on a crew list or given a ticket
-- joins it; the role set here reaches the crew lists that have not said otherwise; leaving the company takes a person
-- off every crew list; a name is never changed and a row never deleted; a labourer reads none of it.
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
  ('11111111-5252-0000-0000-000000000001', 'admin.st@example.com'),
  ('11111111-5252-0000-0000-000000000002', 'sup.st@example.com'),
  ('11111111-5252-0000-0000-000000000003', 'lab.st@example.com'),
  ('11111111-5252-0000-0000-000000000004', 'pm.st@example.com'),
  ('11111111-5252-0000-0000-000000000005', 'other.st@example.com');
insert into public.organisations (id, name, code) values
  ('aaaaaaaa-5252-0000-0000-000000000001', 'Staff List Civil', 'SLC'),
  ('aaaaaaaa-5252-0000-0000-000000000002', 'Someone Else Civil', 'SE2');
insert into public.projects (id, org_id, name, code) values
  ('bbbbbbbb-5252-0000-0000-000000000001', 'aaaaaaaa-5252-0000-0000-000000000001', 'Staff Job One', 'X561'),
  ('bbbbbbbb-5252-0000-0000-000000000002', 'aaaaaaaa-5252-0000-0000-000000000001', 'Staff Job Two', 'X562'),
  ('bbbbbbbb-5252-0000-0000-000000000003', 'aaaaaaaa-5252-0000-0000-000000000002', 'Someone Else Job', 'X563');
insert into public.project_members (project_id, user_id, role) values
  ('bbbbbbbb-5252-0000-0000-000000000001', '11111111-5252-0000-0000-000000000001', 'admin'),
  ('bbbbbbbb-5252-0000-0000-000000000002', '11111111-5252-0000-0000-000000000001', 'admin'),
  ('bbbbbbbb-5252-0000-0000-000000000001', '11111111-5252-0000-0000-000000000002', 'supervisor'),
  ('bbbbbbbb-5252-0000-0000-000000000001', '11111111-5252-0000-0000-000000000003', 'labourer'),
  ('bbbbbbbb-5252-0000-0000-000000000001', '11111111-5252-0000-0000-000000000004', 'pm'),
  ('bbbbbbbb-5252-0000-0000-000000000003', '11111111-5252-0000-0000-000000000005', 'admin');
set local role authenticated;

-- The admin adds a person: tidied, stamped, once.
set local request.jwt.claims = '{"sub":"11111111-5252-0000-0000-000000000001","role":"authenticated"}';
insert into public.staff (id, org_id, name, role, phone) values
  ('cccccccc-5252-0000-0000-000000000001', 'aaaaaaaa-5252-0000-0000-000000000001', '  Evan   Burke ', ' Machine  Op ', ' 0400 000 000 ');
do $$
declare r public.staff;
begin
  select * into r from public.staff where id = 'cccccccc-5252-0000-0000-000000000001';
  if r.name <> 'Evan Burke' or r.role <> 'Machine Op' or r.phone <> '0400 000 000' then raise exception 'TESTFAIL: not tidied'; end if;
  if r.created_by <> '11111111-5252-0000-0000-000000000001' or not r.active then raise exception 'TESTFAIL: not stamped'; end if;
end; $$;
select tests.expect_error($$ insert into public.staff (org_id, name) values ('aaaaaaaa-5252-0000-0000-000000000001', 'evan burke') $$, 'duplicate key');
select tests.expect_error($$ insert into public.staff (org_id, name) values ('aaaaaaaa-5252-0000-0000-000000000001', '   ') $$, 'name');
select tests.expect_error($$ insert into public.staff (org_id, name) values ('aaaaaaaa-5252-0000-0000-000000000002', 'Not Ours') $$, 'row-level security');

-- Put on a job's crew list, a person is on the staff list — with the role the job gave. Someone already there is not doubled.
insert into public.crew (project_id, name, role) values ('bbbbbbbb-5252-0000-0000-000000000001', 'Hamish Hayden', 'Labourer');
insert into public.crew (project_id, name, role) values ('bbbbbbbb-5252-0000-0000-000000000001', 'Evan Burke', 'Machine Op');
insert into public.crew (project_id, name, role) values ('bbbbbbbb-5252-0000-0000-000000000002', 'Evan Burke', 'Truck Driver');
do $$
begin
  if (select count(*) from public.staff where org_id = 'aaaaaaaa-5252-0000-0000-000000000001') <> 2 then raise exception 'TESTFAIL: crew should join the staff list once each'; end if;
  if (select role from public.staff where name = 'Hamish Hayden') <> 'Labourer' then raise exception 'TESTFAIL: the crew role should come across'; end if;
end; $$;
-- Given a ticket, likewise.
insert into public.crew_tickets (org_id, person_name, ticket_type) values ('aaaaaaaa-5252-0000-0000-000000000001', 'Florian', 'white_card');
do $$ begin if not exists (select 1 from public.staff where name = 'Florian' and role is null) then raise exception 'TESTFAIL: a ticket holder should join the staff list'; end if; end; $$;

-- The role set here reaches the crew rows that carried the old one; a job that said otherwise keeps its own.
update public.staff set role = 'Excavator Operator' where id = 'cccccccc-5252-0000-0000-000000000001';
do $$
begin
  if (select role from public.crew where project_id = 'bbbbbbbb-5252-0000-0000-000000000001' and name = 'Evan Burke') <> 'Excavator Operator' then raise exception 'TESTFAIL: role did not reach the crew list'; end if;
  if (select role from public.crew where project_id = 'bbbbbbbb-5252-0000-0000-000000000002' and name = 'Evan Burke') <> 'Truck Driver' then raise exception 'TESTFAIL: a job''s own role was overwritten'; end if;
  if (select updated_at from public.staff where id = 'cccccccc-5252-0000-0000-000000000001') is null then raise exception 'TESTFAIL: updated_at'; end if;
end; $$;

-- A name is not changed (its case may be put right); a row is not deleted.
select tests.expect_error($$ update public.staff set name = 'Evan Burk' where id = 'cccccccc-5252-0000-0000-000000000001' $$, 'not changed');
update public.staff set name = 'Evan BURKE' where id = 'cccccccc-5252-0000-0000-000000000001';
update public.staff set name = 'Evan Burke' where id = 'cccccccc-5252-0000-0000-000000000001';
select tests.expect_error($$ delete from public.staff where id = 'cccccccc-5252-0000-0000-000000000001' $$, 'permission denied');

-- No longer with the company: off every crew list, still on the record.
update public.staff set active = false where id = 'cccccccc-5252-0000-0000-000000000001';
do $$
begin
  if exists (select 1 from public.crew where name = 'Evan Burke' and active) then raise exception 'TESTFAIL: someone who left is still on a crew list'; end if;
  if (select count(*) from public.crew where name = 'Evan Burke') <> 2 then raise exception 'TESTFAIL: crew rows should be kept, hidden'; end if;
  if not exists (select 1 from public.crew where name = 'Hamish Hayden' and active) then raise exception 'TESTFAIL: someone else was taken off'; end if;
end; $$;

-- A supervisor keeps the list too (they keep the tickets); a PM keeps it too (R136); a labourer reads none; another company neither.
set local request.jwt.claims = '{"sub":"11111111-5252-0000-0000-000000000002","role":"authenticated"}';
insert into public.staff (org_id, name, role) values ('aaaaaaaa-5252-0000-0000-000000000001', 'AJ', 'Landscaper');
set local request.jwt.claims = '{"sub":"11111111-5252-0000-0000-000000000004","role":"authenticated"}';
do $$ begin if (select count(*) from public.staff) <> 4 then raise exception 'TESTFAIL: a PM should read the staff list'; end if; end; $$;
do $$ begin
  begin
    insert into public.staff (org_id, name) values ('aaaaaaaa-5252-0000-0000-000000000001', 'PM Adds');
    raise exception 'ROLLBACKOK';
  exception when others then
    if sqlerrm <> 'ROLLBACKOK' then raise exception 'TESTFAIL: the PM should write here (R136): %', sqlerrm; end if;
  end;
  raise notice 'PASS  a PM keeps the staff list too (R136)';
end $$;
set local request.jwt.claims = '{"sub":"11111111-5252-0000-0000-000000000003","role":"authenticated"}';
do $$ begin if (select count(*) from public.staff) <> 0 then raise exception 'TESTFAIL: a labourer reads the staff list'; end if; end; $$;
set local request.jwt.claims = '{"sub":"11111111-5252-0000-0000-000000000005","role":"authenticated"}';
do $$ begin if (select count(*) from public.staff) <> 0 then raise exception 'TESTFAIL: another company reads the staff list'; end if; end; $$;
do $$
declare n integer;
begin
  update public.staff set notes = 'x' where org_id = 'aaaaaaaa-5252-0000-0000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'TESTFAIL: another company changed the staff list'; end if;
end; $$;
rollback;
