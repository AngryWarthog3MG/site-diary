-- Costing allocations for dayworks (README R159): kept beside a SIGNED day only; the people only where the signed row
-- names nobody; names tidied, hours 0..24, a machine on the company's register; register keepers write, the labourer
-- reads none; every change kept; never deleted.
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
  ('11111111-ee60-0000-0000-000000000001', 'sup.dc@example.com'),
  ('11111111-ee60-0000-0000-000000000002', 'lab.dc@example.com'),
  ('11111111-ee60-0000-0000-000000000003', 'other.dc@example.com');
insert into public.organisations (id, name, code) values
  ('aaaaaaaa-ee60-0000-0000-000000000001', 'Alloc Civil', 'DCC'),
  ('aaaaaaaa-ee60-0000-0000-000000000002', 'Other Civil', 'DCO');
insert into public.projects (id, org_id, name, code) values
  ('bbbbbbbb-ee60-0000-0000-000000000001', 'aaaaaaaa-ee60-0000-0000-000000000001', 'Alloc Job', 'X401'),
  ('bbbbbbbb-ee60-0000-0000-000000000002', 'aaaaaaaa-ee60-0000-0000-000000000002', 'Other Job', 'X402');
insert into public.project_members (project_id, user_id, role) values
  ('bbbbbbbb-ee60-0000-0000-000000000001', '11111111-ee60-0000-0000-000000000001', 'supervisor'),
  ('bbbbbbbb-ee60-0000-0000-000000000001', '11111111-ee60-0000-0000-000000000002', 'labourer'),
  ('bbbbbbbb-ee60-0000-0000-000000000002', '11111111-ee60-0000-0000-000000000003', 'supervisor');
insert into public.plant_register (id, org_id, name, kind) values
  ('eeeeeeee-ee60-0000-0000-000000000001', 'aaaaaaaa-ee60-0000-0000-000000000001', 'Vac Trailer', 'vac_trailer'),
  ('eeeeeeee-ee60-0000-0000-000000000002', 'aaaaaaaa-ee60-0000-0000-000000000002', 'Their roller', 'roller');
-- A signed day with two dayworks: one whose row names nobody, one whose row names its people (R129); and a draft day.
insert into public.entries (id, project_id, entry_date, author_id) values
  ('99999999-ee60-0000-0000-000000000001', 'bbbbbbbb-ee60-0000-0000-000000000001', '2026-09-16', '11111111-ee60-0000-0000-000000000001'),
  ('99999999-ee60-0000-0000-000000000002', 'bbbbbbbb-ee60-0000-0000-000000000001', '2026-09-17', '11111111-ee60-0000-0000-000000000001');
insert into public.dayworks (id, entry_id, description, labour, plant, hours) values
  ('88888888-ee60-0000-0000-000000000001', '99999999-ee60-0000-0000-000000000001', 'Vac trailer trenching', '2x Marcus Hayden, Evan Burke', 'Vac Trailer', 10),
  ('88888888-ee60-0000-0000-000000000002', '99999999-ee60-0000-0000-000000000001', 'Forming footpath', null, null, 8),
  ('88888888-ee60-0000-0000-000000000003', '99999999-ee60-0000-0000-000000000002', 'Not signed yet', null, null, 4);
update public.dayworks set labour_rows = '[{"person_name":"Evan Burke","hours":8}]'::jsonb where id = '88888888-ee60-0000-0000-000000000002';
-- The first day is signed the way a day is signed: by the transition, which numbers and hashes it.
update public.entries set status = 'signed' where id = '99999999-ee60-0000-0000-000000000001';

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-ee60-0000-0000-000000000001","role":"authenticated"}';

-- The keeper picks people and plant for the row that names nobody; names tidied, hours rounded.
insert into public.daywork_costings (id, project_id, daywork_id, labour, plant) values
  ('dddddddd-ee60-0000-0000-000000000001', 'bbbbbbbb-ee60-0000-0000-000000000001', '88888888-ee60-0000-0000-000000000001',
   '[{"person_name":"  Marcus   Hayden ","hours":"10"},{"person_name":"Evan Burke","hours":10.004}]',
   '[{"plant_id":"eeeeeeee-ee60-0000-0000-000000000001","name":"Vac Trailer","hours":10}]');
do $$
declare r public.daywork_costings;
begin
  select * into r from public.daywork_costings where id = 'dddddddd-ee60-0000-0000-000000000001';
  if r.labour->0->>'person_name' <> 'Marcus Hayden' then raise exception 'TESTFAIL: name not tidied: %', r.labour; end if;
  if (r.labour->0->>'hours')::numeric <> 10 or (r.labour->1->>'hours')::numeric <> 10 then raise exception 'TESTFAIL: hours not kept: %', r.labour; end if;
  if r.plant->0->>'plant_id' <> 'eeeeeeee-ee60-0000-0000-000000000001' then raise exception 'TESTFAIL: machine not kept: %', r.plant; end if;
end; $$;

-- Where the signed row names its people, only the plant is picked here.
select tests.expect_error(
  $q$insert into public.daywork_costings (project_id, daywork_id, labour) values ('bbbbbbbb-ee60-0000-0000-000000000001', '88888888-ee60-0000-0000-000000000002', '[{"person_name":"Kel","hours":1}]')$q$,
  'already names its people');
insert into public.daywork_costings (id, project_id, daywork_id, plant) values
  ('dddddddd-ee60-0000-0000-000000000002', 'bbbbbbbb-ee60-0000-0000-000000000001', '88888888-ee60-0000-0000-000000000002', '[{"plant_id":null,"name":"Plate compactor","hours":2}]');

-- Not on a draft day; not a daywork of another job; not a machine off the company's register; hours in range; a name.
select tests.expect_error(
  $q$insert into public.daywork_costings (project_id, daywork_id) values ('bbbbbbbb-ee60-0000-0000-000000000001', '88888888-ee60-0000-0000-000000000003')$q$,
  'signed');
select tests.expect_error(
  $q$insert into public.daywork_costings (project_id, daywork_id) values ('bbbbbbbb-ee60-0000-0000-000000000002', '88888888-ee60-0000-0000-000000000001')$q$,
  'not on this job');
select tests.expect_error(
  $q$update public.daywork_costings set plant = '[{"plant_id":"eeeeeeee-ee60-0000-0000-000000000002","name":"Their roller","hours":1}]' where id = 'dddddddd-ee60-0000-0000-000000000001'$q$,
  'register');
select tests.expect_error(
  $q$update public.daywork_costings set labour = '[{"person_name":"Evan Burke","hours":25}]' where id = 'dddddddd-ee60-0000-0000-000000000001'$q$,
  'between 0 and 24');
select tests.expect_error(
  $q$update public.daywork_costings set labour = '[{"person_name":"  ","hours":2}]' where id = 'dddddddd-ee60-0000-0000-000000000001'$q$,
  'needs a name');
select tests.expect_error(
  $q$update public.daywork_costings set daywork_id = '88888888-ee60-0000-0000-000000000002' where id = 'dddddddd-ee60-0000-0000-000000000001'$q$,
  'stays with its daywork');

-- Left out of the claim (R160): a mark with its reason, logged, reversible.
select tests.expect_error(
  $q$update public.daywork_costings set excluded = true where id = 'dddddddd-ee60-0000-0000-000000000002'$q$,
  'excluded_has_reason');
update public.daywork_costings set excluded = true, excluded_reason = 'Not ours to claim' where id = 'dddddddd-ee60-0000-0000-000000000002';
do $$
begin
  if not exists (select 1 from public.daywork_costing_changes where costing_id = 'dddddddd-ee60-0000-0000-000000000002' and new_excluded and new_excluded_reason = 'Not ours to claim') then raise exception 'TESTFAIL: the mark was not logged'; end if;
end; $$;
update public.daywork_costings set excluded = false where id = 'dddddddd-ee60-0000-0000-000000000002';

-- A change is kept; nothing is deleted.
update public.daywork_costings set plant = '[{"plant_id":"eeeeeeee-ee60-0000-0000-000000000001","name":"Vac Trailer","hours":8}]' where id = 'dddddddd-ee60-0000-0000-000000000001';
do $$
declare n integer;
begin
  if (select count(*) from public.daywork_costing_changes where costing_id = 'dddddddd-ee60-0000-0000-000000000001') <> 1 then raise exception 'TESTFAIL: change not kept'; end if;
  if (select updated_by from public.daywork_costings where id = 'dddddddd-ee60-0000-0000-000000000001') <> '11111111-ee60-0000-0000-000000000001' then raise exception 'TESTFAIL: updated_by not stamped'; end if;
  delete from public.daywork_costings where id = 'dddddddd-ee60-0000-0000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'TESTFAIL: a costing was deleted'; end if;
end; $$;

-- The labourer reads none; another job's keeper reads none and writes none.
set local request.jwt.claims = '{"sub":"11111111-ee60-0000-0000-000000000002","role":"authenticated"}';
do $$
begin
  if (select count(*) from public.daywork_costings) <> 0 then raise exception 'TESTFAIL: the labourer read the costings'; end if;
end; $$;
set local request.jwt.claims = '{"sub":"11111111-ee60-0000-0000-000000000003","role":"authenticated"}';
do $$
begin
  if (select count(*) from public.daywork_costings) <> 0 then raise exception 'TESTFAIL: another job read the costings'; end if;
end; $$;
select tests.expect_error(
  $q$insert into public.daywork_costings (project_id, daywork_id) values ('bbbbbbbb-ee60-0000-0000-000000000001', '88888888-ee60-0000-0000-000000000001')$q$,
  'row-level security');

rollback;
