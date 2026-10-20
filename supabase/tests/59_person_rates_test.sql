-- Charge-out rates by person (README R158): read only by someone who sees the money with their code entered; written
-- by an admin alone, with the code; the name tidied; one live rate per name; retired never deleted; every change
-- kept; a rename on the staff list carries the rate.
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
  ('11111111-ee59-0000-0000-000000000001', 'admin.pr@example.com'),
  ('11111111-ee59-0000-0000-000000000002', 'pm.pr@example.com'),
  ('11111111-ee59-0000-0000-000000000003', 'sup.pr@example.com'),
  ('11111111-ee59-0000-0000-000000000004', 'lab.pr@example.com'),
  ('11111111-ee59-0000-0000-000000000005', 'other.pr@example.com');
insert into public.organisations (id, name, code) values
  ('aaaaaaaa-ee59-0000-0000-000000000001', 'Rate Civil', 'PRC'),
  ('aaaaaaaa-ee59-0000-0000-000000000002', 'Other Civil', 'PRO');
insert into public.projects (id, org_id, name, code) values
  ('bbbbbbbb-ee59-0000-0000-000000000001', 'aaaaaaaa-ee59-0000-0000-000000000001', 'Rate Job', 'X301'),
  ('bbbbbbbb-ee59-0000-0000-000000000002', 'aaaaaaaa-ee59-0000-0000-000000000002', 'Other Job', 'X302');
insert into public.project_members (project_id, user_id, role) values
  ('bbbbbbbb-ee59-0000-0000-000000000001', '11111111-ee59-0000-0000-000000000001', 'admin'),
  ('bbbbbbbb-ee59-0000-0000-000000000001', '11111111-ee59-0000-0000-000000000002', 'pm'),
  ('bbbbbbbb-ee59-0000-0000-000000000001', '11111111-ee59-0000-0000-000000000003', 'supervisor'),
  ('bbbbbbbb-ee59-0000-0000-000000000001', '11111111-ee59-0000-0000-000000000004', 'labourer'),
  ('bbbbbbbb-ee59-0000-0000-000000000002', '11111111-ee59-0000-0000-000000000005', 'admin');
-- The supervisor has been shown the money (R105).
update public.project_members set finance = true where user_id = '11111111-ee59-0000-0000-000000000003';
insert into public.staff (id, org_id, name, role) values
  ('cccccccc-ee59-0000-0000-000000000001', 'aaaaaaaa-ee59-0000-0000-000000000001', 'Matty Rogers', 'Supervisor');

set local role authenticated;

-- ---- Writing: the admin, with the code ------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"11111111-ee59-0000-0000-000000000001","role":"authenticated","aal":"aal1"}';
select tests.expect_error(
  $q$insert into public.person_rates (org_id, person_name, rate) values ('aaaaaaaa-ee59-0000-0000-000000000001', 'Evan Burke', 105)$q$,
  'row-level security');

set local request.jwt.claims = '{"sub":"11111111-ee59-0000-0000-000000000001","role":"authenticated","aal":"aal2"}';
insert into public.person_rates (id, org_id, person_name, rate) values
  ('dddddddd-ee59-0000-0000-000000000001', 'aaaaaaaa-ee59-0000-0000-000000000001', '  Evan   Burke ', 105),
  ('dddddddd-ee59-0000-0000-000000000002', 'aaaaaaaa-ee59-0000-0000-000000000001', 'Matty Rogers', 140);
do $$
begin
  if (select person_name from public.person_rates where id = 'dddddddd-ee59-0000-0000-000000000001') <> 'Evan Burke' then raise exception 'TESTFAIL: name not tidied'; end if;
end; $$;
-- One live rate per name, however it is spaced or cased.
select tests.expect_error(
  $q$insert into public.person_rates (org_id, person_name, rate) values ('aaaaaaaa-ee59-0000-0000-000000000001', 'evan burke', 110)$q$,
  'duplicate key');
-- No name, no rate; no negative rate; only hours.
select tests.expect_error(
  $q$insert into public.person_rates (org_id, person_name, rate) values ('aaaaaaaa-ee59-0000-0000-000000000001', '  ', 100)$q$,
  'name');
select tests.expect_error(
  $q$insert into public.person_rates (org_id, person_name, rate) values ('aaaaaaaa-ee59-0000-0000-000000000001', 'Kel Brady', -1)$q$,
  'check');
select tests.expect_error(
  $q$insert into public.person_rates (org_id, person_name, rate, unit) values ('aaaaaaaa-ee59-0000-0000-000000000001', 'Kel Brady', 100, 'day')$q$,
  'check');
-- A change is kept; a retired rate frees the name; never deleted.
update public.person_rates set rate = 110 where id = 'dddddddd-ee59-0000-0000-000000000001';
update public.person_rates set active = false where id = 'dddddddd-ee59-0000-0000-000000000001';
insert into public.person_rates (id, org_id, person_name, rate) values
  ('dddddddd-ee59-0000-0000-000000000003', 'aaaaaaaa-ee59-0000-0000-000000000001', 'Evan Burke', 115);
do $$
begin
  if (select count(*) from public.person_rate_changes where person_rate_id = 'dddddddd-ee59-0000-0000-000000000001') <> 2 then raise exception 'TESTFAIL: changes not kept'; end if;
  if not exists (select 1 from public.person_rate_changes where person_rate_id = 'dddddddd-ee59-0000-0000-000000000001' and old_rate = 105 and new_rate = 110) then raise exception 'TESTFAIL: old rate not kept'; end if;
  if not exists (select 1 from public.person_rate_changes where person_rate_id = 'dddddddd-ee59-0000-0000-000000000001' and old_active and not new_active) then raise exception 'TESTFAIL: retirement not kept'; end if;
end; $$;
do $$
declare n integer;
begin
  delete from public.person_rates where id = 'dddddddd-ee59-0000-0000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'TESTFAIL: a rate was deleted'; end if;
end; $$;

-- ---- Reading: the money, with the code ------------------------------------------------------------------------
-- The PM sees no money by default (R136): the card is empty to them, not an error.
set local request.jwt.claims = '{"sub":"11111111-ee59-0000-0000-000000000002","role":"authenticated","aal":"aal2"}';
do $$
begin
  if (select count(*) from public.person_rates) <> 0 then raise exception 'TESTFAIL: the PM read the rates'; end if;
end; $$;
select tests.expect_error(
  $q$insert into public.person_rates (org_id, person_name, rate) values ('aaaaaaaa-ee59-0000-0000-000000000001', 'Kel Brady', 100)$q$,
  'row-level security');
-- The supervisor shown the money reads them with the code, and not without; writes none.
set local request.jwt.claims = '{"sub":"11111111-ee59-0000-0000-000000000003","role":"authenticated","aal":"aal2"}';
do $$
begin
  if (select count(*) from public.person_rates where active) <> 2 then raise exception 'TESTFAIL: the supervisor with money did not read the rates'; end if;
end; $$;
-- An update the policy refuses touches no row (RLS filters it out rather than raising).
do $$
declare n integer;
begin
  update public.person_rates set rate = 1 where id = 'dddddddd-ee59-0000-0000-000000000002';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'TESTFAIL: the supervisor changed a rate'; end if;
  if (select rate from public.person_rates where id = 'dddddddd-ee59-0000-0000-000000000002') <> 140 then raise exception 'TESTFAIL: the rate moved'; end if;
end; $$;
set local request.jwt.claims = '{"sub":"11111111-ee59-0000-0000-000000000003","role":"authenticated","aal":"aal1"}';
do $$
begin
  if (select count(*) from public.person_rates) <> 0 then raise exception 'TESTFAIL: the rates showed without the code'; end if;
end; $$;
-- The labourer reads none; another company reads none.
set local request.jwt.claims = '{"sub":"11111111-ee59-0000-0000-000000000004","role":"authenticated","aal":"aal2"}';
do $$
begin
  if (select count(*) from public.person_rates) <> 0 then raise exception 'TESTFAIL: the labourer read the rates'; end if;
end; $$;
set local request.jwt.claims = '{"sub":"11111111-ee59-0000-0000-000000000005","role":"authenticated","aal":"aal2"}';
do $$
begin
  if (select count(*) from public.person_rates) <> 0 then raise exception 'TESTFAIL: another company read the rates'; end if;
end; $$;

-- ---- A rename carries the rate ----------------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"11111111-ee59-0000-0000-000000000001","role":"authenticated","aal":"aal2"}';
do $$
declare r jsonb;
begin
  r := public.rename_staff('cccccccc-ee59-0000-0000-000000000001', 'Matthew Rodgers');
  if (r->>'rates')::int <> 1 then raise exception 'TESTFAIL: rename did not carry the rate: %', r; end if;
  if (select person_name from public.person_rates where id = 'dddddddd-ee59-0000-0000-000000000002') <> 'Matthew Rodgers' then raise exception 'TESTFAIL: rate not renamed'; end if;
end; $$;

rollback;
