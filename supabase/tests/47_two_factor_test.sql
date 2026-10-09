-- Two-factor sign-in for the money (README R106). The same person sees the money with a verified second factor
-- (aal2) and not without it (aal1), on every path; granting the money needs the granter's code; a person's own row and
-- the service role are exempt.
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
  ('11111111-ffff-0000-0000-000000000001', 'admin.tf@example.com'),
  ('11111111-ffff-0000-0000-000000000002', 'pm.tf@example.com'),
  ('11111111-ffff-0000-0000-000000000003', 'sup.tf@example.com'),
  ('11111111-ffff-0000-0000-000000000004', 'newpm.tf@example.com');
insert into public.organisations (id, name, code) values ('aaaaaaaa-ffff-0000-0000-000000000001', 'Code Civil', 'TFC');
insert into public.projects (id, org_id, name, code) values ('bbbbbbbb-ffff-0000-0000-000000000001', 'aaaaaaaa-ffff-0000-0000-000000000001', 'Code Job', 'X401');
insert into public.project_members (project_id, user_id, role) values
  ('bbbbbbbb-ffff-0000-0000-000000000001', '11111111-ffff-0000-0000-000000000001', 'admin'),
  ('bbbbbbbb-ffff-0000-0000-000000000001', '11111111-ffff-0000-0000-000000000002', 'pm'),  -- switched on below: by default a PM sees none of it (R136)
  ('bbbbbbbb-ffff-0000-0000-000000000001', '11111111-ffff-0000-0000-000000000003', 'supervisor');
update public.project_members set finance = true where user_id = '11111111-ffff-0000-0000-000000000002';
insert into public.variation_register (id, project_id, title, raised_on, estimated_cost) values
  ('cccccccc-ffff-0000-0000-000000000001', 'bbbbbbbb-ffff-0000-0000-000000000001', 'Extra drainage', '2026-09-21', 2500);
insert into public.rate_items (org_id, kind, label, rate) values ('aaaaaaaa-ffff-0000-0000-000000000001', 'labour', 'Labourer', 95);

set local role authenticated;

-- ---- The PM with the email link only: entitled, but the money stays shut --------------------------------------
set local request.jwt.claims = '{"sub":"11111111-ffff-0000-0000-000000000002","role":"authenticated","aal":"aal1"}';
do $$
begin
  if public.sees_money('bbbbbbbb-ffff-0000-0000-000000000001') then raise exception 'TESTFAIL: aal1 should not see money'; end if;
  if (select count(*) from public.variation_values('bbbbbbbb-ffff-0000-0000-000000000001')) <> 0 then raise exception 'TESTFAIL: aal1 got values'; end if;
  if (select count(*) from public.rate_items) <> 0 then raise exception 'TESTFAIL: aal1 reads rates'; end if;
  if (select count(*) from public.variation_register) <> 1 then raise exception 'TESTFAIL: aal1 should still read the register itself'; end if;
end; $$;
select tests.expect_error($$ insert into public.rate_items (org_id, kind, label, rate) values ('aaaaaaaa-ffff-0000-0000-000000000001', 'labour', 'Operator', 120) $$, 'row-level security');
-- A pricing call at aal1 changes no money and hands none back.
do $$
declare r public.variation_register;
begin
  r := public.set_variation_details('cccccccc-ffff-0000-0000-000000000001', 'VR-1', 9999, null, 1, false);
  if r.estimated_cost is not null or r.agreed_cost is not null then raise exception 'TESTFAIL: aal1 pricing handed money back'; end if;
end; $$;
-- A session with no aal at all (an old token) is treated as aal1.
set local request.jwt.claims = '{"sub":"11111111-ffff-0000-0000-000000000002","role":"authenticated"}';
do $$ begin if public.sees_money('bbbbbbbb-ffff-0000-0000-000000000001') then raise exception 'TESTFAIL: no aal should not see money'; end if; end; $$;

-- ---- The same PM after the code ---------------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"11111111-ffff-0000-0000-000000000002","role":"authenticated","aal":"aal2"}';
do $$
begin
  if not public.sees_money('bbbbbbbb-ffff-0000-0000-000000000001') then raise exception 'TESTFAIL: aal2 PM should see money'; end if;
  if (select estimated_cost from public.variation_values('bbbbbbbb-ffff-0000-0000-000000000001')) <> 2500 then raise exception 'TESTFAIL: the aal1 pricing call should not have moved the value'; end if;
  if (select count(*) from public.rate_items) <> 1 then raise exception 'TESTFAIL: aal2 PM should read the rate'; end if;
end; $$;

-- ---- A supervisor with the code still sees nothing: the code opens only what the person is entitled to -----------
set local request.jwt.claims = '{"sub":"11111111-ffff-0000-0000-000000000003","role":"authenticated","aal":"aal2"}';
do $$ begin if public.sees_money('bbbbbbbb-ffff-0000-0000-000000000001') then raise exception 'TESTFAIL: a code must not grant money to a supervisor'; end if; end; $$;

-- ---- Granting the money needs the admin's code ---------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"11111111-ffff-0000-0000-000000000001","role":"authenticated","aal":"aal1"}';
select tests.expect_error($$ update public.project_members set finance = true where user_id = '11111111-ffff-0000-0000-000000000003' $$, 'two-factor code');
select tests.expect_error($$ insert into public.project_members (project_id, user_id, role, finance) values ('bbbbbbbb-ffff-0000-0000-000000000001', '11111111-ffff-0000-0000-000000000004', 'pm', true) $$, 'two-factor code');
select tests.expect_error($$ update public.project_members set role = 'admin' where user_id = '11111111-ffff-0000-0000-000000000003' $$, 'two-factor code');
-- Changes that give no money do not need it: a supervisor added, screens ticked, money taken away.
insert into public.project_members (project_id, user_id, role) values ('bbbbbbbb-ffff-0000-0000-000000000001', '11111111-ffff-0000-0000-000000000004', 'supervisor');
update public.project_members set screens = array['entries'] where user_id = '11111111-ffff-0000-0000-000000000003';
update public.project_members set finance = false where user_id = '11111111-ffff-0000-0000-000000000002';
-- With the code, the grant goes through.
set local request.jwt.claims = '{"sub":"11111111-ffff-0000-0000-000000000001","role":"authenticated","aal":"aal2"}';
update public.project_members set finance = true where user_id = '11111111-ffff-0000-0000-000000000003';
do $$
begin
  if not (select finance from public.project_members where user_id = '11111111-ffff-0000-0000-000000000003') then raise exception 'TESTFAIL: the grant with the code did not save'; end if;
end; $$;

-- ---- The service role is exempt (the bulk add checks the code itself) ----------------------------------------------
reset role;
set local request.jwt.claims = '{}';
update public.project_members set finance = null where user_id = '11111111-ffff-0000-0000-000000000002';

rollback;
