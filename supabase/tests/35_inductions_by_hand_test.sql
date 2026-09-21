-- Inducting by hand: the name is tidied, the date is any day up to today and never after, one induction per person
-- per job however the name is cased, whoever runs the talks records it, and the labourer records nothing.
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
  ('11111111-3333-0000-0000-000000000001', 'sup.induct@example.com'),
  ('11111111-3333-0000-0000-000000000002', 'lab.induct@example.com');
insert into public.organisations (id, name, code) values ('aaaaaaaa-3333-0000-0000-000000000001', 'Induct Civil', 'INC');
insert into public.projects (id, org_id, name, code) values ('bbbbbbbb-3333-0000-0000-000000000001', 'aaaaaaaa-3333-0000-0000-000000000001', 'Induct Job', 'I001');
insert into public.project_members (project_id, user_id, role) values
  ('bbbbbbbb-3333-0000-0000-000000000001', '11111111-3333-0000-0000-000000000001', 'supervisor'),
  ('bbbbbbbb-3333-0000-0000-000000000001', '11111111-3333-0000-0000-000000000002', 'labourer');

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-3333-0000-0000-000000000001","role":"authenticated"}';

-- Recorded two days after it happened, with what was covered; the name and the notes tidied.
insert into public.crew_inductions (project_id, person_name, inducted_on, notes, inducted_by)
values ('bbbbbbbb-3333-0000-0000-000000000001', '  hamish   hayden ', app.perth_today() - 2, '  Site rules, muster point,  the  wash bay ', '11111111-3333-0000-0000-000000000001');

do $$
declare r public.crew_inductions;
begin
  select * into r from public.crew_inductions where project_id = 'bbbbbbbb-3333-0000-0000-000000000001';
  if r.person_name <> 'hamish hayden' then raise exception 'TESTFAIL: name not tidied, got "%"', r.person_name; end if;
  if r.notes <> 'Site rules, muster point, the wash bay' then raise exception 'TESTFAIL: notes not tidied, got "%"', r.notes; end if;
  if r.inducted_on <> app.perth_today() - 2 then raise exception 'TESTFAIL: the date given was not kept'; end if;
  if r.inducted_by <> '11111111-3333-0000-0000-000000000001' then raise exception 'TESTFAIL: recorder not kept'; end if;
end; $$;

-- Never dated ahead of today.
select tests.expect_error($$
  insert into public.crew_inductions (project_id, person_name, inducted_on, inducted_by)
  values ('bbbbbbbb-3333-0000-0000-000000000001', 'Someone Else', app.perth_today() + 1, '11111111-3333-0000-0000-000000000001')
$$, 'once it has happened');

-- One induction per person per job, however the name is cased or spaced.
select tests.expect_error($$
  insert into public.crew_inductions (project_id, person_name, inducted_by)
  values ('bbbbbbbb-3333-0000-0000-000000000001', 'HAMISH  HAYDEN', '11111111-3333-0000-0000-000000000001')
$$, 'crew_inductions_one_per_person_idx');

-- A blank name is nobody.
select tests.expect_error($$
  insert into public.crew_inductions (project_id, person_name, inducted_by)
  values ('bbbbbbbb-3333-0000-0000-000000000001', '   ', '11111111-3333-0000-0000-000000000001')
$$, 'who was inducted');

-- Leaving the recorder out stamps the caller.
insert into public.crew_inductions (project_id, person_name)
values ('bbbbbbbb-3333-0000-0000-000000000001', 'Visitor Vic');
do $$
declare v uuid;
begin
  select inducted_by into v from public.crew_inductions where project_id = 'bbbbbbbb-3333-0000-0000-000000000001' and person_name = 'Visitor Vic';
  if v <> '11111111-3333-0000-0000-000000000001' then raise exception 'TESTFAIL: recorder not stamped from the session'; end if;
end; $$;

-- The labourer reads who is inducted (it is their site) but records nothing.
set local request.jwt.claims = '{"sub":"11111111-3333-0000-0000-000000000002","role":"authenticated"}';
do $$
declare n integer;
begin
  select count(*) into n from public.crew_inductions where project_id = 'bbbbbbbb-3333-0000-0000-000000000001';
  if n <> 2 then raise exception 'TESTFAIL: a member should read the job''s inductions, got %', n; end if;
end; $$;
select tests.expect_error($$
  insert into public.crew_inductions (project_id, person_name)
  values ('bbbbbbbb-3333-0000-0000-000000000001', 'Not Allowed')
$$, 'row-level security');

rollback;
