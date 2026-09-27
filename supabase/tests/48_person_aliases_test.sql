-- The company's list of names that are one person (README R107): the office adds and removes; a supervisor reads but
-- cannot change it; a labourer reads nothing; a name is never combined with itself; one alias, one person.
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
  ('11111111-9999-0000-0000-000000000001', 'pm.pa@example.com'),
  ('11111111-9999-0000-0000-000000000002', 'sup.pa@example.com'),
  ('11111111-9999-0000-0000-000000000003', 'lab.pa@example.com');
insert into public.organisations (id, name, code) values ('aaaaaaaa-9999-0000-0000-000000000001', 'Alias Civil', 'PAC');
insert into public.projects (id, org_id, name, code) values ('bbbbbbbb-9999-0000-0000-000000000001', 'aaaaaaaa-9999-0000-0000-000000000001', 'Alias Job', 'X501');
insert into public.project_members (project_id, user_id, role) values
  ('bbbbbbbb-9999-0000-0000-000000000001', '11111111-9999-0000-0000-000000000001', 'pm'),
  ('bbbbbbbb-9999-0000-0000-000000000001', '11111111-9999-0000-0000-000000000002', 'supervisor'),
  ('bbbbbbbb-9999-0000-0000-000000000001', '11111111-9999-0000-0000-000000000003', 'labourer');
set local role authenticated;

set local request.jwt.claims = '{"sub":"11111111-9999-0000-0000-000000000001","role":"authenticated"}';
insert into public.person_aliases (org_id, alias, name) values ('aaaaaaaa-9999-0000-0000-000000000001', '  Matt   Rodgers ', 'Matthew Rodgers');
do $$ begin if (select alias from public.person_aliases) <> 'Matt Rodgers' then raise exception 'TESTFAIL: alias not tidied'; end if; end; $$;
select tests.expect_error($$ insert into public.person_aliases (org_id, alias, name) values ('aaaaaaaa-9999-0000-0000-000000000001', 'matt rodgers', 'Someone Else') $$, 'duplicate key');
select tests.expect_error($$ insert into public.person_aliases (org_id, alias, name) values ('aaaaaaaa-9999-0000-0000-000000000001', 'Evan Burke', 'evan burke') $$, 'itself');

set local request.jwt.claims = '{"sub":"11111111-9999-0000-0000-000000000002","role":"authenticated"}';
do $$ begin if (select count(*) from public.person_aliases) <> 1 then raise exception 'TESTFAIL: a supervisor should read the list'; end if; end; $$;
select tests.expect_error($$ insert into public.person_aliases (org_id, alias, name) values ('aaaaaaaa-9999-0000-0000-000000000001', 'Matty', 'Matthew Rodgers') $$, 'row-level security');
do $$
declare n integer;
begin
  delete from public.person_aliases;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'TESTFAIL: a supervisor removed a combination'; end if;
end; $$;

set local request.jwt.claims = '{"sub":"11111111-9999-0000-0000-000000000003","role":"authenticated"}';
do $$ begin if (select count(*) from public.person_aliases) <> 0 then raise exception 'TESTFAIL: a labourer reads the list'; end if; end; $$;

set local request.jwt.claims = '{"sub":"11111111-9999-0000-0000-000000000001","role":"authenticated"}';
delete from public.person_aliases where lower(alias) = 'matt rodgers';
do $$ begin if (select count(*) from public.person_aliases) <> 0 then raise exception 'TESTFAIL: the office should undo a combination'; end if; end; $$;
rollback;
