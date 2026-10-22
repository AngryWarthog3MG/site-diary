-- A labourer checks the plant they operate, in their own name, on their own jobs (README R162): the check is theirs
-- (conducted_by, operator = own profile name), they complete it and raise its defects; another name, another job, a
-- labourer not on the job — refused; they read their own checks, defects and tickets and nothing else of the record.
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
  ('11111111-ee61-0000-0000-000000000001', 'sup.pc@example.com'),
  ('11111111-ee61-0000-0000-000000000002', 'marcus.pc@example.com'),
  ('11111111-ee61-0000-0000-000000000003', 'other.pc@example.com'),
  ('11111111-ee61-0000-0000-000000000004', 'nina.pc@example.com');
insert into public.profiles (id, full_name) values
  ('11111111-ee61-0000-0000-000000000001', 'Sue Super'),
  ('11111111-ee61-0000-0000-000000000002', 'Marcus Hayden'),
  ('11111111-ee61-0000-0000-000000000003', 'Olly Other'),
  ('11111111-ee61-0000-0000-000000000004', 'Nina Nocard')
on conflict (id) do update set full_name = excluded.full_name;
insert into public.organisations (id, name, code) values ('aaaaaaaa-ee61-0000-0000-000000000001', 'Check Civil', 'PCC');
insert into public.projects (id, org_id, name, code) values
  ('bbbbbbbb-ee61-0000-0000-000000000001', 'aaaaaaaa-ee61-0000-0000-000000000001', 'Check Job', 'X501'),
  ('bbbbbbbb-ee61-0000-0000-000000000002', 'aaaaaaaa-ee61-0000-0000-000000000001', 'Other Job', 'X502');
insert into public.project_members (project_id, user_id, role) values
  ('bbbbbbbb-ee61-0000-0000-000000000001', '11111111-ee61-0000-0000-000000000001', 'supervisor'),
  ('bbbbbbbb-ee61-0000-0000-000000000001', '11111111-ee61-0000-0000-000000000002', 'labourer'),
  ('bbbbbbbb-ee61-0000-0000-000000000002', '11111111-ee61-0000-0000-000000000003', 'labourer'),
  ('bbbbbbbb-ee61-0000-0000-000000000001', '11111111-ee61-0000-0000-000000000004', 'labourer'),
  ('bbbbbbbb-ee61-0000-0000-000000000002', '11111111-ee61-0000-0000-000000000002', 'labourer');
insert into public.plant_register (id, org_id, name, kind) values
  ('eeeeeeee-ee61-0000-0000-000000000001', 'aaaaaaaa-ee61-0000-0000-000000000001', '1.8t Excavator', 'excavator');
insert into public.project_plant (project_id, plant_id) values ('bbbbbbbb-ee61-0000-0000-000000000001', 'eeeeeeee-ee61-0000-0000-000000000001');
-- Marcus holds the ticket the machine needs; Olly's tickets are not his to read.
insert into public.crew_tickets (org_id, person_name, ticket_type, expires_on) values
  ('aaaaaaaa-ee61-0000-0000-000000000001', 'Marcus Hayden', 'excavator', (app.perth_today() + 365)::date),
  ('aaaaaaaa-ee61-0000-0000-000000000001', 'Olly Other', 'white_card', null),
  ('aaaaaaaa-ee61-0000-0000-000000000001', 'Nina Nocard', 'white_card', null);
-- A check the supervisor made, which is the record and not Marcus's to read.
insert into public.plant_prestarts (id, project_id, plant_id, prestart_date, operator_name, checks, fit_for_use, conducted_by) values
  ('dddddddd-ee61-0000-0000-000000000009', 'bbbbbbbb-ee61-0000-0000-000000000001', 'eeeeeeee-ee61-0000-0000-000000000001', app.perth_today(), 'Sue Super',
   '[{"key":"walk","label":"Walk around","result":"ok"}]', true, '11111111-ee61-0000-0000-000000000001');

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-ee61-0000-0000-000000000002","role":"authenticated"}';

-- Marcus checks the excavator in his own name.
insert into public.plant_prestarts (id, project_id, plant_id, prestart_date, operator_name, checks, fit_for_use, conducted_by) values
  ('dddddddd-ee61-0000-0000-000000000001', 'bbbbbbbb-ee61-0000-0000-000000000001', 'eeeeeeee-ee61-0000-0000-000000000001', app.perth_today(), '  marcus   HAYDEN ',
   '[{"key":"walk","label":"Walk around","result":"ok"},{"key":"brakes","label":"Brakes","result":"defect"}]', false, '11111111-ee61-0000-0000-000000000002');
-- Not in another name (a job he is not on is Olly's case below).
select tests.expect_error(
  $q$insert into public.plant_prestarts (project_id, plant_id, prestart_date, operator_name, checks, fit_for_use, conducted_by) values
     ('bbbbbbbb-ee61-0000-0000-000000000001', 'eeeeeeee-ee61-0000-0000-000000000001', app.perth_today(), 'Sue Super', '[]', true, '11111111-ee61-0000-0000-000000000002')$q$,
  'row-level security');
-- His defect on his check.
insert into public.plant_defects (project_id, plant_id, prestart_id, item_key, item_label, raised_by) values
  ('bbbbbbbb-ee61-0000-0000-000000000001', 'eeeeeeee-ee61-0000-0000-000000000001', 'dddddddd-ee61-0000-0000-000000000001', 'brakes', 'Brakes', '11111111-ee61-0000-0000-000000000002');
-- Not a defect on the supervisor's check.
select tests.expect_error(
  $q$insert into public.plant_defects (project_id, plant_id, prestart_id, item_key, item_label, raised_by) values
     ('bbbbbbbb-ee61-0000-0000-000000000001', 'eeeeeeee-ee61-0000-0000-000000000001', 'dddddddd-ee61-0000-0000-000000000009', 'walk', 'Walk around', '11111111-ee61-0000-0000-000000000002')$q$,
  'row-level security');
-- He completes it with his signature; the database stamps the time; then it is frozen.
update public.plant_prestarts set signature_path = 'bbbbbbbb-ee61-0000-0000-000000000001/plant/dddddddd-ee61-0000-0000-000000000001/sig.png'
 where id = 'dddddddd-ee61-0000-0000-000000000001';
do $$
declare r public.plant_prestarts;
begin
  select * into r from public.plant_prestarts where id = 'dddddddd-ee61-0000-0000-000000000001';
  if r.id is null then raise exception 'TESTFAIL: Marcus cannot read his own check'; end if;
  if r.completed_at is null then raise exception 'TESTFAIL: the signature did not complete it'; end if;
  if (select count(*) from public.plant_prestarts) <> 1 then raise exception 'TESTFAIL: Marcus read a check that is not his'; end if;
  if (select count(*) from public.plant_defects) <> 1 then raise exception 'TESTFAIL: Marcus read defects that are not his'; end if;
  if (select count(*) from public.crew_tickets) <> 1 then raise exception 'TESTFAIL: Marcus read tickets that are not his'; end if;
  if (select person_name from public.crew_tickets limit 1) <> 'Marcus Hayden' then raise exception 'TESTFAIL: the wrong ticket'; end if;
end; $$;
-- Signed, it is out of his reach: the policy filters it, so the update touches no row and nothing moves.
do $$
declare n integer;
begin
  update public.plant_prestarts set notes = 'late' where id = 'dddddddd-ee61-0000-0000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'TESTFAIL: a signed check was changed'; end if;
  if (select notes from public.plant_prestarts where id = 'dddddddd-ee61-0000-0000-000000000001') is not null then raise exception 'TESTFAIL: the note landed'; end if;
end; $$;

-- His open check stays with its job and its machine: Marcus is on the other job too, and may not move it there.
insert into public.plant_prestarts (id, project_id, plant_id, prestart_date, operator_name, checks, fit_for_use, conducted_by) values
  ('dddddddd-ee61-0000-0000-000000000002', 'bbbbbbbb-ee61-0000-0000-000000000001', 'eeeeeeee-ee61-0000-0000-000000000001', app.perth_today(), 'Marcus Hayden',
   '[{"key":"walk","label":"Walk around","result":"ok"}]', true, '11111111-ee61-0000-0000-000000000002');
select tests.expect_error(
  $q$update public.plant_prestarts set project_id = 'bbbbbbbb-ee61-0000-0000-000000000002' where id = 'dddddddd-ee61-0000-0000-000000000002'$q$,
  'stays with its job');

-- The ticket rule is unchanged for a labourer: Nina holds a white card only, and the excavator needs more.
set local request.jwt.claims = '{"sub":"11111111-ee61-0000-0000-000000000004","role":"authenticated"}';
insert into public.plant_prestarts (id, project_id, plant_id, prestart_date, operator_name, checks, fit_for_use, conducted_by) values
  ('dddddddd-ee61-0000-0000-000000000003', 'bbbbbbbb-ee61-0000-0000-000000000001', 'eeeeeeee-ee61-0000-0000-000000000001', app.perth_today(), 'Nina Nocard',
   '[{"key":"walk","label":"Walk around","result":"ok"}]', true, '11111111-ee61-0000-0000-000000000004');
select tests.expect_error(
  $q$update public.plant_prestarts set signature_path = 'bbbbbbbb-ee61-0000-0000-000000000001/plant/dddddddd-ee61-0000-0000-000000000003/sig.png' where id = 'dddddddd-ee61-0000-0000-000000000003'$q$,
  'do not cover this machine');

-- A labourer not on the job writes none and reads none.
set local request.jwt.claims = '{"sub":"11111111-ee61-0000-0000-000000000003","role":"authenticated"}';
select tests.expect_error(
  $q$insert into public.plant_prestarts (project_id, plant_id, prestart_date, operator_name, checks, fit_for_use, conducted_by) values
     ('bbbbbbbb-ee61-0000-0000-000000000001', 'eeeeeeee-ee61-0000-0000-000000000001', app.perth_today(), 'Olly Other', '[]', true, '11111111-ee61-0000-0000-000000000003')$q$,
  'row-level security');
do $$
begin
  if (select count(*) from public.plant_prestarts) <> 0 then raise exception 'TESTFAIL: Olly read checks on a job he is not on'; end if;
end; $$;

-- The supervisor still reads everything on the job.
set local request.jwt.claims = '{"sub":"11111111-ee61-0000-0000-000000000001","role":"authenticated"}';
do $$
begin
  if (select count(*) from public.plant_prestarts where project_id = 'bbbbbbbb-ee61-0000-0000-000000000001') <> 4 then raise exception 'TESTFAIL: the supervisor does not read every check'; end if;
end; $$;

rollback;
