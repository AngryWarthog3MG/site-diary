-- A PM who manages people (README R150): adds, removes and retitles people on the job, and nothing that reaches the
-- money — never an admin, never the money switch, never their own row, never the flag itself. A PM without the flag
-- changes nothing.
begin;
create schema tests;
grant usage on schema tests to public;
create function tests.expect_error(p_sql text, p_fragment text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'TESTFAIL: expected failure but statement succeeded: %', p_sql;
exception when others then
  if sqlerrm like 'TESTFAIL:%' then raise; end if;
  if position(lower(p_fragment) in lower(sqlerrm)) = 0 then
    raise exception 'TESTFAIL: wrong error for [%] — got "%", expected "%"', p_sql, sqlerrm, p_fragment;
  end if;
end; $$;
insert into auth.users (id, email) values
  ('11111111-5858-0000-0000-000000000001', 'admin.pmg@example.com'),
  ('11111111-5858-0000-0000-000000000002', 'office.pmg@example.com'),
  ('11111111-5858-0000-0000-000000000003', 'plainpm.pmg@example.com'),
  ('11111111-5858-0000-0000-000000000004', 'lab.pmg@example.com'),
  ('11111111-5858-0000-0000-000000000005', 'new.pmg@example.com');
insert into public.organisations (id, name, code) values ('aaaaaaaa-5858-0000-0000-000000000001', 'Manage Civil', 'MGC');
insert into public.projects (id, org_id, name, code) values ('bbbbbbbb-5858-0000-0000-000000000001', 'aaaaaaaa-5858-0000-0000-000000000001', 'Manage Job', 'F581');
insert into public.project_members (project_id, user_id, role, manages_people) values
  ('bbbbbbbb-5858-0000-0000-000000000001', '11111111-5858-0000-0000-000000000001', 'admin', false),
  ('bbbbbbbb-5858-0000-0000-000000000001', '11111111-5858-0000-0000-000000000002', 'pm', true),
  ('bbbbbbbb-5858-0000-0000-000000000001', '11111111-5858-0000-0000-000000000003', 'pm', false),
  ('bbbbbbbb-5858-0000-0000-000000000001', '11111111-5858-0000-0000-000000000004', 'labourer', false);
set local role authenticated;

-- A plain PM changes nothing: RLS lets the write touch no rows.
set local request.jwt.claims = '{"sub":"11111111-5858-0000-0000-000000000003","role":"authenticated"}';
do $$ declare n integer; begin
  update public.project_members set role = 'supervisor' where user_id = '11111111-5858-0000-0000-000000000004';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'TESTFAIL: a plain PM changed a title'; end if;
end $$;
select tests.expect_error($$ insert into public.project_members (project_id, user_id, role) values ('bbbbbbbb-5858-0000-0000-000000000001', '11111111-5858-0000-0000-000000000005', 'labourer') $$, 'row-level security');

-- The office PM: adds, retitles, removes.
set local request.jwt.claims = '{"sub":"11111111-5858-0000-0000-000000000002","role":"authenticated"}';
insert into public.project_members (project_id, user_id, role) values ('bbbbbbbb-5858-0000-0000-000000000001', '11111111-5858-0000-0000-000000000005', 'labourer');
update public.project_members set role = 'supervisor' where user_id = '11111111-5858-0000-0000-000000000004';
do $$ begin
  if (select role from public.project_members where user_id = '11111111-5858-0000-0000-000000000004') <> 'supervisor' then raise exception 'TESTFAIL: the office PM could not retitle'; end if;
end $$;
-- And not: an admin, the money, their own row, the flag.
select tests.expect_error($$ update public.project_members set role = 'admin' where user_id = '11111111-5858-0000-0000-000000000004' $$, 'Only an admin makes');
select tests.expect_error($$ update public.project_members set role = 'pm' where user_id = '11111111-5858-0000-0000-000000000001' $$, 'Only an admin makes');
select tests.expect_error($$ delete from public.project_members where user_id = '11111111-5858-0000-0000-000000000001' $$, 'Only an admin makes');
select tests.expect_error($$ update public.project_members set finance = true where user_id = '11111111-5858-0000-0000-000000000004' $$, 'money switch');
select tests.expect_error($$ insert into public.project_members (project_id, user_id, role, finance) values ('bbbbbbbb-5858-0000-0000-000000000001', '11111111-5858-0000-0000-000000000003', 'supervisor', true) $$, 'money switch');
select tests.expect_error($$ update public.project_members set manages_people = true where user_id = '11111111-5858-0000-0000-000000000003' $$, 'who manages people');
select tests.expect_error($$ update public.project_members set role = 'supervisor' where user_id = '11111111-5858-0000-0000-000000000002' $$, 'your own membership');
delete from public.project_members where user_id = '11111111-5858-0000-0000-000000000005';
do $$ begin
  if exists (select 1 from public.project_members where user_id = '11111111-5858-0000-0000-000000000005') then raise exception 'TESTFAIL: the office PM could not remove a labourer'; end if;
  if not app.can_manage_people('bbbbbbbb-5858-0000-0000-000000000001') then raise exception 'TESTFAIL: can_manage_people is false for the office PM'; end if;
end $$;

-- The admin grants and takes the flag, and makes admins, as ever.
set local request.jwt.claims = '{"sub":"11111111-5858-0000-0000-000000000001","role":"authenticated","aal":"aal2"}';
update public.project_members set manages_people = true where user_id = '11111111-5858-0000-0000-000000000003';
update public.project_members set manages_people = false where user_id = '11111111-5858-0000-0000-000000000002';
do $$ begin
  if not (select manages_people from public.project_members where user_id = '11111111-5858-0000-0000-000000000003') then raise exception 'TESTFAIL: the admin could not grant the flag'; end if;
  raise notice 'PASS  a PM who manages people adds, removes and retitles, and never reaches the money (R150)';
end $$;
rollback;
