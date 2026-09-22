-- The closeout loop: a job's own items (manual, contract) are promoted into the templates or left as one-offs, once;
-- a template is generic; the decision is written by the functions alone; a promoted item is not stamped back onto the
-- job that gave it, but reaches the next job; the office alone decides.
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
  ('11111111-8888-0000-0000-000000000001', 'pm.close@example.com'),
  ('11111111-8888-0000-0000-000000000002', 'sup.close@example.com'),
  ('11111111-8888-0000-0000-000000000003', 'outsider.close@example.com');
insert into public.organisations (id, name, code) values
  ('aaaaaaaa-8888-0000-0000-000000000001', 'Closeout Civil', 'CLC'),
  ('aaaaaaaa-8888-0000-0000-000000000002', 'Other Close', 'OCC');
insert into public.projects (id, org_id, name, code, principal_contractor) values
  ('bbbbbbbb-8888-0000-0000-000000000001', 'aaaaaaaa-8888-0000-0000-000000000001', 'Stamp Hotel', 'H101', 'CDI Group'),
  ('bbbbbbbb-8888-0000-0000-000000000002', 'aaaaaaaa-8888-0000-0000-000000000001', 'Next Job', 'H102', null),
  ('bbbbbbbb-8888-0000-0000-000000000003', 'aaaaaaaa-8888-0000-0000-000000000002', 'Other Job', 'O301', null);
insert into public.project_members (project_id, user_id, role) values
  ('bbbbbbbb-8888-0000-0000-000000000001', '11111111-8888-0000-0000-000000000001', 'pm'),
  ('bbbbbbbb-8888-0000-0000-000000000002', '11111111-8888-0000-0000-000000000001', 'pm'),
  ('bbbbbbbb-8888-0000-0000-000000000001', '11111111-8888-0000-0000-000000000002', 'supervisor'),
  ('bbbbbbbb-8888-0000-0000-000000000003', '11111111-8888-0000-0000-000000000003', 'admin');
insert into public.template_modules (org_id, key, name, sort) values
  ('aaaaaaaa-8888-0000-0000-000000000001', 'core', 'Core', 10),
  ('aaaaaaaa-8888-0000-0000-000000000001', 'earthworks', 'Earthworks', 20);
insert into public.template_items (id, org_id, module_key, kind, title, min_tier) values
  ('cccccccc-8888-0000-0000-000000000001', 'aaaaaaaa-8888-0000-0000-000000000001', 'core', 'start_gate', 'Signed contract on file', 'light');

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-8888-0000-0000-000000000001","role":"authenticated"}';

-- The job is stamped (1 library item), then adds one by hand and one from its contract.
do $$
declare r jsonb;
begin
  r := public.instantiate_project('bbbbbbbb-8888-0000-0000-000000000001', '{earthworks}', 'full');
  if (r->>'added')::integer <> 1 then raise exception 'TESTFAIL: expected 1 stamped, got %', r; end if;
end; $$;
insert into public.project_setup_items (id, project_id, kind, category, title, detail, priority, owner_role, origin)
values ('dddddddd-8888-0000-0000-000000000001', 'bbbbbbbb-8888-0000-0000-000000000001', 'hold_point', 'Earthworks', 'Proof roll witnessed by CDI Group before fill', 'LOI cl. 4: “CDI Group must witness…”', 'A', 'site', 'contract'),
       ('dddddddd-8888-0000-0000-000000000002', 'bbbbbbbb-8888-0000-0000-000000000001', 'start_gate', 'Access', 'Rail corridor permit for Stamp Hotel', null, 'B', 'office', 'manual');

-- 1. Promote the contract item into earthworks, reworded. The library grows; the item records what it became.
do $$
declare v uuid; t record; s record;
begin
  v := public.promote_setup_item('dddddddd-8888-0000-0000-000000000001', 'earthworks', '  Proof roll witnessed by the head contractor  before fill ', 'Earthworks', 'The head contractor’s geotechnical engineer inspects the proof roll.', 'full', 'A', 'site');
  select * into t from public.template_items where id = v;
  if t.org_id <> 'aaaaaaaa-8888-0000-0000-000000000001' or t.module_key <> 'earthworks' or t.kind <> 'hold_point' or t.origin <> 'contract'
     or t.title <> 'Proof roll witnessed by the head contractor before fill' or t.priority <> 'A' or t.owner_role <> 'site' or t.min_tier <> 'full'
     or t.created_by <> '11111111-8888-0000-0000-000000000001' then
    raise exception 'TESTFAIL: promoted template item wrong: %', row_to_json(t); end if;
  select * into s from public.project_setup_items where id = 'dddddddd-8888-0000-0000-000000000001';
  if s.promotion_decision <> 'promoted' or s.promoted_template_item_id <> v or s.decided_by <> '11111111-8888-0000-0000-000000000001' or s.decided_at is null then
    raise exception 'TESTFAIL: setup item not stamped with its promotion: % % %', s.promotion_decision, s.promoted_template_item_id, s.decided_by; end if;
  if s.title <> 'Proof roll witnessed by CDI Group before fill' then raise exception 'TESTFAIL: the job''s own item must keep its wording'; end if;
end; $$;

-- 2. Once. And a template is generic.
select tests.expect_error($$ select public.promote_setup_item('dddddddd-8888-0000-0000-000000000001', 'core', 'Again') $$, 'already been promoted');
select tests.expect_error($$ select public.promote_setup_item('dddddddd-8888-0000-0000-000000000002', 'core', 'Rail corridor permit — cdi group to countersign') $$, 'must not name the head contractor');
select tests.expect_error($$ select public.promote_setup_item('dddddddd-8888-0000-0000-000000000002', 'core', 'Rail corridor permit', null, 'As on Stamp Hotel') $$, 'must not name the job');
select tests.expect_error($$ select public.promote_setup_item('dddddddd-8888-0000-0000-000000000002', 'plumbing', 'Rail corridor permit') $$, 'no module called');
select tests.expect_error($$ select public.promote_setup_item('dddddddd-8888-0000-0000-000000000002', 'core', '   ') $$, 'needs a title');

-- 3. What came from the library is not up for a decision.
select tests.expect_error($$
  select public.promote_setup_item((select id from public.project_setup_items where template_item_id = 'cccccccc-8888-0000-0000-000000000001'), 'core', 'x')
$$, 'nothing to promote');
select tests.expect_error($$
  select public.leave_setup_item((select id from public.project_setup_items where template_item_id = 'cccccccc-8888-0000-0000-000000000001'))
$$, 'nothing to decide');

-- 4. Leave as a one-off, then change your mind: a one-off can still be promoted.
do $$
declare s record; v uuid;
begin
  perform public.leave_setup_item('dddddddd-8888-0000-0000-000000000002');
  select * into s from public.project_setup_items where id = 'dddddddd-8888-0000-0000-000000000002';
  if s.promotion_decision <> 'one_off' or s.promoted_template_item_id is not null or s.decided_at is null then raise exception 'TESTFAIL: one-off not recorded'; end if;
  v := public.promote_setup_item('dddddddd-8888-0000-0000-000000000002', 'core', 'Rail corridor permit where the site abuts a rail reserve', 'Access', null, 'light', 'B', 'office');
  select * into s from public.project_setup_items where id = 'dddddddd-8888-0000-0000-000000000002';
  if s.promotion_decision <> 'promoted' or s.promoted_template_item_id <> v then raise exception 'TESTFAIL: a one-off should still promote'; end if;
  if (select origin from public.template_items where id = v) <> 'manual' then raise exception 'TESTFAIL: origin manual should carry into the library'; end if;
end; $$;
-- (A caught exception inside a DO block would roll the block's writes back, so the refusal is asserted outside it.)
select tests.expect_error($$ select public.leave_setup_item('dddddddd-8888-0000-0000-000000000002') $$, 'already been promoted');

-- 5. The decision cannot be written directly, even by the office.
select tests.expect_error($$
  update public.project_setup_items set promotion_decision = 'one_off' where id = 'dddddddd-8888-0000-0000-000000000001'
$$, 'through promote or leave');
select tests.expect_error($$
  update public.project_setup_items set promoted_template_item_id = null where id = 'dddddddd-8888-0000-0000-000000000001'
$$, 'through promote or leave');
-- …while an ordinary change to the same row still works.
update public.project_setup_items set status = 'done' where id = 'dddddddd-8888-0000-0000-000000000001';

-- 6. Re-stamping the job does not double what it promoted; the next job gets both.
do $$
declare r jsonb; n integer;
begin
  r := public.instantiate_project('bbbbbbbb-8888-0000-0000-000000000001', '{}', null);
  if (r->>'added')::integer <> 0 then raise exception 'TESTFAIL: re-stamp should add nothing, added % (%)', r->>'added', r; end if;
  r := public.instantiate_project('bbbbbbbb-8888-0000-0000-000000000002', '{earthworks}', 'full');
  if (r->>'added')::integer <> 3 then raise exception 'TESTFAIL: the next job should get the library item plus both promoted ones, got %', r; end if;
  select count(*) into n from public.project_setup_items where project_id = 'bbbbbbbb-8888-0000-0000-000000000002' and origin = 'template' and title = 'Proof roll witnessed by the head contractor before fill';
  if n <> 1 then raise exception 'TESTFAIL: the promoted hold point should reach the next job as a template item'; end if;
end; $$;

-- 7. The supervisor and another company's admin do not decide.
set local request.jwt.claims = '{"sub":"11111111-8888-0000-0000-000000000002","role":"authenticated"}';
select tests.expect_error($$ select public.leave_setup_item('dddddddd-8888-0000-0000-000000000001') $$, 'only the office');
set local request.jwt.claims = '{"sub":"11111111-8888-0000-0000-000000000003","role":"authenticated"}';
select tests.expect_error($$ select public.promote_setup_item('dddddddd-8888-0000-0000-000000000001', 'core', 'x') $$, 'only the office');

rollback;
