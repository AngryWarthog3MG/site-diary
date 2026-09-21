-- A job is stamped from the company's templates at its tier; core always; only what is missing is added; the office
-- alone sees and works the board; done is stamped by the DB; nothing is deleted; due dates count from the start date;
-- a job born through create_project is born stamped.
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
create function tests.n(p_sql text) returns integer language plpgsql as $$
declare r integer; begin execute p_sql into r; return r; end; $$;

insert into auth.users (id, email) values
  ('11111111-7777-0000-0000-000000000001', 'pm.stamp@example.com'),
  ('11111111-7777-0000-0000-000000000002', 'sup.stamp@example.com'),
  ('11111111-7777-0000-0000-000000000003', 'lab.stamp@example.com'),
  ('11111111-7777-0000-0000-000000000004', 'outsider.stamp@example.com'),
  ('11111111-7777-0000-0000-000000000005', 'admin.stamp@example.com');
insert into public.organisations (id, name, code) values
  ('aaaaaaaa-7777-0000-0000-000000000001', 'Stamp Civil', 'STC'),
  ('aaaaaaaa-7777-0000-0000-000000000002', 'Other Stamp', 'OSC');
insert into public.projects (id, org_id, name, code, tier) values
  ('bbbbbbbb-7777-0000-0000-000000000001', 'aaaaaaaa-7777-0000-0000-000000000001', 'Stamp Job', 'S101', 'light'),
  ('bbbbbbbb-7777-0000-0000-000000000002', 'aaaaaaaa-7777-0000-0000-000000000002', 'Other Job', 'O201', 'full'),
  ('bbbbbbbb-7777-0000-0000-000000000003', 'aaaaaaaa-7777-0000-0000-000000000001', 'Born Full', 'S103', 'full');
insert into public.project_members (project_id, user_id, role) values
  ('bbbbbbbb-7777-0000-0000-000000000001', '11111111-7777-0000-0000-000000000001', 'pm'),
  ('bbbbbbbb-7777-0000-0000-000000000001', '11111111-7777-0000-0000-000000000002', 'supervisor'),
  ('bbbbbbbb-7777-0000-0000-000000000001', '11111111-7777-0000-0000-000000000003', 'labourer'),
  ('bbbbbbbb-7777-0000-0000-000000000001', '11111111-7777-0000-0000-000000000005', 'admin'),
  ('bbbbbbbb-7777-0000-0000-000000000003', '11111111-7777-0000-0000-000000000001', 'pm'),
  ('bbbbbbbb-7777-0000-0000-000000000002', '11111111-7777-0000-0000-000000000004', 'admin');
insert into public.template_modules (org_id, key, name, sort) values
  ('aaaaaaaa-7777-0000-0000-000000000001', 'core', 'Core', 10),
  ('aaaaaaaa-7777-0000-0000-000000000001', 'earthworks', 'Earthworks', 20),
  ('aaaaaaaa-7777-0000-0000-000000000001', 'remote', 'Remote', 40);
-- The library: core has two light start gate items, one full start gate item, a light document, a light folder, a full
-- risk; earthworks has a full consumable and a full hold point; remote has a full start gate item. One retired item
-- must never stamp.
insert into public.template_items (id, org_id, module_key, kind, category, title, priority, min_tier, owner_role, due_offset_days, unit, par_level, folder_no, active) values
  ('cccccccc-7777-0000-0000-000000000001', 'aaaaaaaa-7777-0000-0000-000000000001', 'core', 'start_gate', 'Contract', 'Signed contract or LOI on file', 'A', 'light', 'office', 0, null, null, null, true),
  ('cccccccc-7777-0000-0000-000000000002', 'aaaaaaaa-7777-0000-0000-000000000001', 'core', 'start_gate', 'Insurance', 'Public liability current', 'A', 'light', 'office', -7, null, null, null, true),
  ('cccccccc-7777-0000-0000-000000000003', 'aaaaaaaa-7777-0000-0000-000000000001', 'core', 'start_gate', 'Programme', 'Baseline programme issued', 'B', 'full', 'office', 14, null, null, null, true),
  ('cccccccc-7777-0000-0000-000000000004', 'aaaaaaaa-7777-0000-0000-000000000001', 'core', 'document', 'Insurance', 'Certificate of currency', null, 'light', null, null, null, null, 5, true),
  ('cccccccc-7777-0000-0000-000000000005', 'aaaaaaaa-7777-0000-0000-000000000001', 'core', 'folder', null, '01 Contract', null, 'light', null, null, null, null, 1, true),
  ('cccccccc-7777-0000-0000-000000000006', 'aaaaaaaa-7777-0000-0000-000000000001', 'core', 'risk', 'Commercial', 'Time bar on notices', 'A', 'full', 'office', null, null, null, null, true),
  ('cccccccc-7777-0000-0000-000000000007', 'aaaaaaaa-7777-0000-0000-000000000001', 'earthworks', 'consumable', '15 Site consumables', 'Marking paint', null, 'full', 'site', null, 'cans', 6, null, true),
  ('cccccccc-7777-0000-0000-000000000008', 'aaaaaaaa-7777-0000-0000-000000000001', 'earthworks', 'hold_point', 'Subgrade', 'Subgrade proof roll witnessed', 'A', 'full', 'site', null, null, null, null, true),
  ('cccccccc-7777-0000-0000-000000000009', 'aaaaaaaa-7777-0000-0000-000000000001', 'remote', 'start_gate', 'Travel', 'Camp booked', 'B', 'full', 'office', -3, null, null, null, true),
  ('cccccccc-7777-0000-0000-000000000010', 'aaaaaaaa-7777-0000-0000-000000000001', 'core', 'start_gate', 'Old', 'Retired item', 'C', 'light', 'office', null, null, null, null, false);

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-7777-0000-0000-000000000001","role":"authenticated"}';

-- 1. The PM stamps a light job with no extra modules: core's light items only, and core is attached.
do $$
declare r jsonb; n integer;
begin
  r := public.instantiate_project('bbbbbbbb-7777-0000-0000-000000000001', '{}', null);
  if (r->>'added')::integer <> 4 then raise exception 'TESTFAIL: light core should stamp 4 items, stamped % (%)', r->>'added', r; end if;
  if r->'modules' <> '["core"]'::jsonb then raise exception 'TESTFAIL: modules should be core alone, got %', r->'modules'; end if;
  select count(*) into n from public.project_setup_items where project_id = 'bbbbbbbb-7777-0000-0000-000000000001' and template_item_id = 'cccccccc-7777-0000-0000-000000000010';
  if n <> 0 then raise exception 'TESTFAIL: a retired template item was stamped'; end if;
  select count(*) into n from public.project_setup_items where project_id = 'bbbbbbbb-7777-0000-0000-000000000001' and status <> 'open';
  if n <> 0 then raise exception 'TESTFAIL: items are born open'; end if;
  select count(*) into n from public.project_setup_items where project_id = 'bbbbbbbb-7777-0000-0000-000000000001' and due_on is not null;
  if n <> 0 then raise exception 'TESTFAIL: no start date yet, so no due dates'; end if;
end; $$;

-- 2. Again: nothing more.
do $$
declare r jsonb;
begin
  r := public.instantiate_project('bbbbbbbb-7777-0000-0000-000000000001', '{}', null);
  if (r->>'added')::integer <> 0 then raise exception 'TESTFAIL: a second run should add nothing, added %', r->>'added'; end if;
end; $$;

-- 3. Earthworks at full: the tier rises, core's full items come too, remote stays out.
do $$
declare r jsonb; n integer; t text;
begin
  r := public.instantiate_project('bbbbbbbb-7777-0000-0000-000000000001', '{earthworks}', 'full');
  if (r->>'added')::integer <> 4 then raise exception 'TESTFAIL: full + earthworks should add 4 (core full ×2, earthworks ×2), added % (%)', r->>'added', r; end if;
  if r->'modules' <> '["core","earthworks"]'::jsonb then raise exception 'TESTFAIL: modules %', r->'modules'; end if;
  if r->'by_kind'->>'consumable' <> '1' or r->'by_kind'->>'hold_point' <> '1' then raise exception 'TESTFAIL: by_kind %', r->'by_kind'; end if;
  select tier into t from public.projects where id = 'bbbbbbbb-7777-0000-0000-000000000001';
  if t <> 'full' then raise exception 'TESTFAIL: tier should have risen to full, is %', t; end if;
  select count(*) into n from public.project_setup_items where project_id = 'bbbbbbbb-7777-0000-0000-000000000001';
  if n <> 8 then raise exception 'TESTFAIL: 8 items expected on the board, found %', n; end if;
  -- Light never lowers it.
  r := public.instantiate_project('bbbbbbbb-7777-0000-0000-000000000001', '{}', 'light');
  select tier into t from public.projects where id = 'bbbbbbbb-7777-0000-0000-000000000001';
  if t <> 'full' then raise exception 'TESTFAIL: a tier never lowers'; end if;
end; $$;

-- 3b. A job that has never been set up carries 'full' from birth; its first stamping takes the tier it is given.
do $$
declare r jsonb; t text;
begin
  r := public.instantiate_project('bbbbbbbb-7777-0000-0000-000000000003', '{}', 'light');
  select tier into t from public.projects where id = 'bbbbbbbb-7777-0000-0000-000000000003';
  if t <> 'light' then raise exception 'TESTFAIL: the first stamping should set the tier to light, is %', t; end if;
  if (r->>'added')::integer <> 4 then raise exception 'TESTFAIL: light core = 4 items, added %', r->>'added'; end if;
  -- Now it is set up: light again is a no-op, full raises.
  r := public.instantiate_project('bbbbbbbb-7777-0000-0000-000000000003', '{}', 'full');
  select tier into t from public.projects where id = 'bbbbbbbb-7777-0000-0000-000000000003';
  if t <> 'full' or (r->>'added')::integer <> 2 then raise exception 'TESTFAIL: raising to full should add core''s 2 full items, added % tier %', r->>'added', t; end if;
  r := public.instantiate_project('bbbbbbbb-7777-0000-0000-000000000003', '{}', 'light');
  select tier into t from public.projects where id = 'bbbbbbbb-7777-0000-0000-000000000003';
  if t <> 'full' then raise exception 'TESTFAIL: once set up, a tier never lowers'; end if;
end; $$;

-- 4. A module the company does not have; a tier that is not a tier.
select tests.expect_error($$ select public.instantiate_project('bbbbbbbb-7777-0000-0000-000000000001', '{plumbing}', null) $$, 'no module called');
select tests.expect_error($$ select public.instantiate_project('bbbbbbbb-7777-0000-0000-000000000001', '{}', 'medium') $$, 'light or full');

-- 5. The start date fills due dates on open items with an offset; those without stay null.
do $$
declare d date; n integer;
begin
  perform public.set_project_start('bbbbbbbb-7777-0000-0000-000000000001', date '2026-10-05');
  select due_on into d from public.project_setup_items where project_id = 'bbbbbbbb-7777-0000-0000-000000000001' and template_item_id = 'cccccccc-7777-0000-0000-000000000002';
  if d <> date '2026-09-28' then raise exception 'TESTFAIL: -7 days from 5 Oct should be 28 Sep, got %', d; end if;
  select due_on into d from public.project_setup_items where project_id = 'bbbbbbbb-7777-0000-0000-000000000001' and template_item_id = 'cccccccc-7777-0000-0000-000000000003';
  if d <> date '2026-10-19' then raise exception 'TESTFAIL: +14 days should be 19 Oct, got %', d; end if;
  select count(*) into n from public.project_setup_items where project_id = 'bbbbbbbb-7777-0000-0000-000000000001' and due_offset_days is null and due_on is not null;
  if n <> 0 then raise exception 'TESTFAIL: an item with no offset got a due date'; end if;
end; $$;

-- 6. Done is stamped by the DB — who and when — whatever the client sends; reopen clears it; not applicable takes a note.
do $$
declare who uuid; at_ timestamptz; st text;
begin
  update public.project_setup_items set status = 'done', done_by = '11111111-7777-0000-0000-000000000004', done_at = '2001-01-01'
   where project_id = 'bbbbbbbb-7777-0000-0000-000000000001' and template_item_id = 'cccccccc-7777-0000-0000-000000000001';
  select done_by, done_at into who, at_ from public.project_setup_items where project_id = 'bbbbbbbb-7777-0000-0000-000000000001' and template_item_id = 'cccccccc-7777-0000-0000-000000000001';
  if who <> '11111111-7777-0000-0000-000000000001' then raise exception 'TESTFAIL: done_by should be the caller, is %', who; end if;
  if at_ < now() - interval '1 minute' then raise exception 'TESTFAIL: done_at should be now, is %', at_; end if;
  update public.project_setup_items set status = 'open' where project_id = 'bbbbbbbb-7777-0000-0000-000000000001' and template_item_id = 'cccccccc-7777-0000-0000-000000000001';
  select done_by, done_at into who, at_ from public.project_setup_items where project_id = 'bbbbbbbb-7777-0000-0000-000000000001' and template_item_id = 'cccccccc-7777-0000-0000-000000000001';
  if who is not null or at_ is not null then raise exception 'TESTFAIL: reopen should clear the stamp'; end if;
  update public.project_setup_items set status = 'not_applicable', status_note = ' No camp: day trips ' where project_id = 'bbbbbbbb-7777-0000-0000-000000000001' and template_item_id = 'cccccccc-7777-0000-0000-000000000003';
  select status into st from public.project_setup_items where project_id = 'bbbbbbbb-7777-0000-0000-000000000001' and template_item_id = 'cccccccc-7777-0000-0000-000000000003';
  if st <> 'not_applicable' then raise exception 'TESTFAIL: not applicable did not take'; end if;
  -- A finished item keeps its date when the start moves.
  perform public.set_project_start('bbbbbbbb-7777-0000-0000-000000000001', date '2026-10-12');
  if (select due_on from public.project_setup_items where project_id = 'bbbbbbbb-7777-0000-0000-000000000001' and template_item_id = 'cccccccc-7777-0000-0000-000000000003') <> date '2026-10-19' then
    raise exception 'TESTFAIL: a not-applicable item should keep the due date it had'; end if;
  if (select due_on from public.project_setup_items where project_id = 'bbbbbbbb-7777-0000-0000-000000000001' and template_item_id = 'cccccccc-7777-0000-0000-000000000002') <> date '2026-10-05' then
    raise exception 'TESTFAIL: an open item follows the start date'; end if;
end; $$;

-- 7. A manual item: born open, its origin fixed; a document needs its folder; nothing moves between jobs; nothing is deleted.
insert into public.project_setup_items (id, project_id, kind, category, title, priority, origin)
values ('dddddddd-7777-0000-0000-000000000001', 'bbbbbbbb-7777-0000-0000-000000000001', 'start_gate', 'Access', 'Rail corridor permit', 'A', 'manual');
select tests.expect_error($$
  insert into public.project_setup_items (project_id, kind, title, origin) values ('bbbbbbbb-7777-0000-0000-000000000001', 'document', 'Nowhere', 'manual')
$$, 'names its folder');
select tests.expect_error($$
  update public.project_setup_items set origin = 'template' where id = 'dddddddd-7777-0000-0000-000000000001'
$$, 'stays what it was stamped as');
reset role;
select tests.expect_error($$
  update public.project_setup_items set project_id = 'bbbbbbbb-7777-0000-0000-000000000002' where id = 'dddddddd-7777-0000-0000-000000000001'
$$, 'stays what it was stamped as');
select tests.expect_error($$
  delete from public.project_setup_items where id = 'dddddddd-7777-0000-0000-000000000001'
$$, 'never changed or removed');
select tests.expect_error($$
  delete from public.project_modules where project_id = 'bbbbbbbb-7777-0000-0000-000000000001' and module_key = 'earthworks'
$$, 'never changed or removed');
set local role authenticated;

-- 8. The supervisor and the labourer see none of the board and cannot stamp; the other company's admin neither.
set local request.jwt.claims = '{"sub":"11111111-7777-0000-0000-000000000002","role":"authenticated"}';
do $$
begin
  if tests.n('select count(*) from public.project_setup_items') <> 0 then raise exception 'TESTFAIL: the supervisor read the board'; end if;
  if tests.n('select count(*) from public.project_modules') <> 0 then raise exception 'TESTFAIL: the supervisor read the modules'; end if;
end; $$;
select tests.expect_error($$ select public.instantiate_project('bbbbbbbb-7777-0000-0000-000000000001', '{remote}', null) $$, 'only the office');
select tests.expect_error($$ select public.set_project_start('bbbbbbbb-7777-0000-0000-000000000001', date '2026-11-01') $$, 'only the office');
select tests.expect_error($$
  insert into public.project_setup_items (project_id, kind, title, origin) values ('bbbbbbbb-7777-0000-0000-000000000001', 'risk', 'Not mine', 'manual')
$$, 'row-level security');
set local request.jwt.claims = '{"sub":"11111111-7777-0000-0000-000000000003","role":"authenticated"}';
do $$
begin
  if tests.n('select count(*) from public.project_setup_items') <> 0 then raise exception 'TESTFAIL: the labourer read the board'; end if;
end; $$;
set local request.jwt.claims = '{"sub":"11111111-7777-0000-0000-000000000004","role":"authenticated"}';
do $$
begin
  if tests.n('select count(*) from public.project_setup_items where project_id = ''bbbbbbbb-7777-0000-0000-000000000001''') <> 0 then raise exception 'TESTFAIL: another company read the board'; end if;
end; $$;
select tests.expect_error($$ select public.instantiate_project('bbbbbbbb-7777-0000-0000-000000000001', '{}', null) $$, 'only the office');

-- 9. The admin reads it all; and a job born through create_project is born stamped, at its tier, with its modules.
set local request.jwt.claims = '{"sub":"11111111-7777-0000-0000-000000000005","role":"authenticated"}';
do $$
declare r jsonb; pid uuid; n integer; t text; d date;
begin
  if tests.n('select count(*) from public.project_setup_items where project_id = ''bbbbbbbb-7777-0000-0000-000000000001''') <> 9 then
    raise exception 'TESTFAIL: the admin should read the 9 items'; end if;
  r := public.create_project('aaaaaaaa-7777-0000-0000-000000000001', 'Born Stamped', 'S102', 'Head Co', null, null, 'light', '{remote}', date '2026-11-02');
  pid := (r->>'project_id')::uuid;
  if (r->'stamped'->>'added')::integer <> 4 then raise exception 'TESTFAIL: a light job with remote should be born with 4 items (core light), got %', r->'stamped'; end if;
  select tier, start_on into t, d from public.projects where id = pid;
  if t <> 'light' or d <> date '2026-11-02' then raise exception 'TESTFAIL: tier/start not kept: % %', t, d; end if;
  select count(*) into n from public.project_modules where project_id = pid;
  if n <> 2 then raise exception 'TESTFAIL: core + remote should be attached, found %', n; end if;
  select due_on into d from public.project_setup_items where project_id = pid and template_item_id = 'cccccccc-7777-0000-0000-000000000002';
  if d <> date '2026-10-26' then raise exception 'TESTFAIL: born with a start date, due dates should be filled: %', d; end if;
  if not exists (select 1 from public.project_members where project_id = pid and user_id = '11111111-7777-0000-0000-000000000005' and role = 'admin') then
    raise exception 'TESTFAIL: the creator is seated as admin'; end if;
  -- Raise it to full later: remote's full start gate item and core's full items arrive.
  r := public.instantiate_project(pid, '{}', 'full');
  if (r->>'added')::integer <> 3 then raise exception 'TESTFAIL: raising to full should add 3, added % (%)', r->>'added', r; end if;
end; $$;

rollback;
