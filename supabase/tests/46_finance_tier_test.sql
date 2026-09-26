-- The finance tier (README R105): money is its own permission, enforced by the database. The register's values and a
-- submission's claimed total cannot be selected by a signed-in account; they come back only through functions that
-- ask first. Defaults by role, the per-person switch, admins always, leading hands never; pricing without money access
-- changes nothing; every access change is logged, and only an admin reads the log.
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
  ('11111111-eeee-0000-0000-000000000001', 'admin.ft@example.com'),
  ('11111111-eeee-0000-0000-000000000002', 'pm.ft@example.com'),
  ('11111111-eeee-0000-0000-000000000003', 'pmoff.ft@example.com'),
  ('11111111-eeee-0000-0000-000000000004', 'sup.ft@example.com'),
  ('11111111-eeee-0000-0000-000000000005', 'supon.ft@example.com'),
  ('11111111-eeee-0000-0000-000000000006', 'lh.ft@example.com');
insert into public.organisations (id, name, code) values ('aaaaaaaa-eeee-0000-0000-000000000001', 'Finance Civil', 'FTC');
insert into public.projects (id, org_id, name, code) values ('bbbbbbbb-eeee-0000-0000-000000000001', 'aaaaaaaa-eeee-0000-0000-000000000001', 'Finance Job', 'X301');
insert into public.project_members (project_id, user_id, role, finance) values
  ('bbbbbbbb-eeee-0000-0000-000000000001', '11111111-eeee-0000-0000-000000000001', 'admin', false),        -- an admin always sees it, whatever this says
  ('bbbbbbbb-eeee-0000-0000-000000000001', '11111111-eeee-0000-0000-000000000002', 'pm', null),            -- a PM by default
  ('bbbbbbbb-eeee-0000-0000-000000000001', '11111111-eeee-0000-0000-000000000003', 'pm', false),           -- a PM switched off
  ('bbbbbbbb-eeee-0000-0000-000000000001', '11111111-eeee-0000-0000-000000000004', 'supervisor', null),    -- a supervisor by default: no
  ('bbbbbbbb-eeee-0000-0000-000000000001', '11111111-eeee-0000-0000-000000000005', 'supervisor', true),    -- a supervisor switched on
  ('bbbbbbbb-eeee-0000-0000-000000000001', '11111111-eeee-0000-0000-000000000006', 'leading_hand', true);  -- a leading hand never, whatever this says
insert into public.variation_register (id, project_id, title, raised_on, estimated_cost) values
  ('cccccccc-eeee-0000-0000-000000000001', 'bbbbbbbb-eeee-0000-0000-000000000001', 'Extra kerb', '2026-09-20', 1000);
insert into public.rate_items (org_id, kind, label, rate) values ('aaaaaaaa-eeee-0000-0000-000000000001', 'labour', 'Labourer', 95);
insert into public.rate_items (org_id, project_id, kind, label, rate) values ('aaaaaaaa-eeee-0000-0000-000000000001', 'bbbbbbbb-eeee-0000-0000-000000000001', 'labour', 'Supervisor', 130);

set local role authenticated;

-- ---- A supervisor by default sees none of it -------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"11111111-eeee-0000-0000-000000000004","role":"authenticated","aal":"aal2"}';
select tests.expect_error($$ select estimated_cost from public.variation_register $$, 'permission denied');
select tests.expect_error($$ select agreed_cost from public.variation_register $$, 'permission denied');
select tests.expect_error($$ select * from public.variation_register $$, 'permission denied');
select tests.expect_error($$ select claimed_total from public.variation_status_events $$, 'permission denied');
do $$
begin
  if (select count(*) from public.variation_register) <> 1 then raise exception 'TESTFAIL: supervisor should still read the register itself'; end if;
  if (select title from public.variation_register) <> 'Extra kerb' then raise exception 'TESTFAIL: supervisor should read the name'; end if;
  if (select count(*) from public.variation_values('bbbbbbbb-eeee-0000-0000-000000000001')) <> 0 then raise exception 'TESTFAIL: supervisor got values'; end if;
  if (select count(*) from public.rate_items) <> 0 then raise exception 'TESTFAIL: supervisor reads rates'; end if;
  if public.sees_money('bbbbbbbb-eeee-0000-0000-000000000001') then raise exception 'TESTFAIL: supervisor should not see money'; end if;
end; $$;
-- They still move it along and name it; the row handed back carries no money.
do $$
declare r public.variation_register;
begin
  r := public.set_variation_status('cccccccc-eeee-0000-0000-000000000001', 'priced', 'from site');
  if r.estimated_cost is not null or r.status <> 'priced' then raise exception 'TESTFAIL: status move leaked money or failed: % %', r.estimated_cost, r.status; end if;
  r := public.set_variation_details('cccccccc-eeee-0000-0000-000000000001', 'VR-22', 5, 'client asked', 7, false);
  if r.estimated_cost is not null or r.agreed_cost is not null or r.vr_ref <> 'VR-22' then raise exception 'TESTFAIL: details leaked money or lost the reference'; end if;
end; $$;
select tests.expect_error($$ insert into public.variation_cost_lines (register_id, project_id, kind, description, quantity, rate) values ('cccccccc-eeee-0000-0000-000000000001', 'bbbbbbbb-eeee-0000-0000-000000000001', 'labour', 'Labourer', 1, 95) $$, 'row-level security');
-- Their own money switch is not theirs to flip.
do $$
declare n integer;
begin
  update public.project_members set finance = true where user_id = '11111111-eeee-0000-0000-000000000004';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'TESTFAIL: a supervisor switched their own money on'; end if;
end; $$;
do $$ begin if (select count(*) from public.member_access_events) <> 0 then raise exception 'TESTFAIL: supervisor reads the access log'; end if; end; $$;

-- The supervisor's pricing call changed no money.
reset role;
do $$
declare r record;
begin
  select estimated_cost, agreed_cost, vr_ref into r from public.variation_register where id = 'cccccccc-eeee-0000-0000-000000000001';
  if r.estimated_cost <> 1000 or r.agreed_cost is not null or r.vr_ref <> 'VR-22' then raise exception 'TESTFAIL: money moved without money access: % %', r.estimated_cost, r.agreed_cost; end if;
end; $$;
set local role authenticated;

-- ---- A supervisor switched on sees it and prices -------------------------------------------------------------
set local request.jwt.claims = '{"sub":"11111111-eeee-0000-0000-000000000005","role":"authenticated","aal":"aal2"}';
do $$
begin
  if (select estimated_cost from public.variation_values('bbbbbbbb-eeee-0000-0000-000000000001')) <> 1000 then raise exception 'TESTFAIL: switched-on supervisor should see 1000'; end if;
  if (select count(*) from public.rate_items) <> 2 then raise exception 'TESTFAIL: switched-on supervisor should read both rates'; end if;
end; $$;
insert into public.variation_cost_lines (register_id, project_id, kind, description, quantity, rate) values
  ('cccccccc-eeee-0000-0000-000000000001', 'bbbbbbbb-eeee-0000-0000-000000000001', 'labour', 'Labourer', 8, 95);
select tests.expect_error($$ insert into public.rate_items (org_id, kind, label, rate) values ('aaaaaaaa-eeee-0000-0000-000000000001', 'labour', 'Operator', 120) $$, 'row-level security');

-- ---- A PM by default sees it and sets rates; a PM switched off does neither ------------------------------------
set local request.jwt.claims = '{"sub":"11111111-eeee-0000-0000-000000000002","role":"authenticated","aal":"aal2"}';
do $$
begin
  if (select estimated_cost from public.variation_values('bbbbbbbb-eeee-0000-0000-000000000001')) <> 760 then raise exception 'TESTFAIL: PM should see the built-up 760'; end if;
end; $$;
insert into public.rate_items (org_id, kind, label, rate) values ('aaaaaaaa-eeee-0000-0000-000000000001', 'labour', 'Operator', 120);
select public.set_variation_status('cccccccc-eeee-0000-0000-000000000001', 'submitted', 'sent');
do $$ begin if (select claimed_total from public.variation_submissions('cccccccc-eeee-0000-0000-000000000001')) <> 760 then raise exception 'TESTFAIL: PM should read what was claimed'; end if; end; $$;

set local request.jwt.claims = '{"sub":"11111111-eeee-0000-0000-000000000003","role":"authenticated","aal":"aal2"}';
do $$
begin
  if (select count(*) from public.variation_values('bbbbbbbb-eeee-0000-0000-000000000001')) <> 0 then raise exception 'TESTFAIL: switched-off PM got values'; end if;
  if (select count(*) from public.variation_submissions('cccccccc-eeee-0000-0000-000000000001')) <> 0 then raise exception 'TESTFAIL: switched-off PM got the claimed total'; end if;
  if (select count(*) from public.rate_items) <> 0 then raise exception 'TESTFAIL: switched-off PM reads rates'; end if;
  if (select count(*) from public.variation_cost_lines) <> 0 then raise exception 'TESTFAIL: switched-off PM reads the build-up'; end if;
end; $$;
select tests.expect_error($$ insert into public.rate_items (org_id, kind, label, rate) values ('aaaaaaaa-eeee-0000-0000-000000000001', 'labour', 'Driver', 110) $$, 'row-level security');

-- ---- A leading hand never, whatever the switch says --------------------------------------------------------------
set local request.jwt.claims = '{"sub":"11111111-eeee-0000-0000-000000000006","role":"authenticated","aal":"aal2"}';
do $$
begin
  if public.sees_money('bbbbbbbb-eeee-0000-0000-000000000001') then raise exception 'TESTFAIL: a leading hand sees money'; end if;
  if (select count(*) from public.variation_values('bbbbbbbb-eeee-0000-0000-000000000001')) <> 0 then raise exception 'TESTFAIL: a leading hand got values'; end if;
end; $$;

-- ---- An admin always, and the access log ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"11111111-eeee-0000-0000-000000000001","role":"authenticated","aal":"aal2"}';
do $$
begin
  if not public.sees_money('bbbbbbbb-eeee-0000-0000-000000000001') then raise exception 'TESTFAIL: an admin with the switch off still sees money'; end if;
  if (select estimated_cost from public.variation_values('bbbbbbbb-eeee-0000-0000-000000000001')) <> 760 then raise exception 'TESTFAIL: admin should see 760'; end if;
end; $$;
-- The admin shows the default supervisor the money; the log says who, what and by whom.
update public.project_members set finance = true where user_id = '11111111-eeee-0000-0000-000000000004';
do $$
declare e record;
begin
  select * into e from public.member_access_events where user_id = '11111111-eeee-0000-0000-000000000004' and kind = 'changed' order by changed_at desc limit 1;
  if e is null or e.money_before or not e.money_after or e.changed_by <> '11111111-eeee-0000-0000-000000000001' then
    raise exception 'TESTFAIL: the money switch was not logged as expected';
  end if;
  if (select count(*) from public.member_access_events where project_id = 'bbbbbbbb-eeee-0000-0000-000000000001' and kind = 'added') <> 6 then
    raise exception 'TESTFAIL: the six people added should each be logged';
  end if;
end; $$;
set local request.jwt.claims = '{"sub":"11111111-eeee-0000-0000-000000000004","role":"authenticated","aal":"aal2"}';
do $$ begin if (select count(*) from public.variation_values('bbbbbbbb-eeee-0000-0000-000000000001')) <> 1 then raise exception 'TESTFAIL: the switch did not open the money'; end if; end; $$;

-- ---- Nobody signed out reads the register at all ---------------------------------------------------------------
set local role anon;
select tests.expect_error($$ select title from public.variation_register $$, 'permission denied');

rollback;
