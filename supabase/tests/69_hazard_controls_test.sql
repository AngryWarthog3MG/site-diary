-- Hazard controls (README R179): controls on the hierarchy, stamped as they go in, withdrawn only with a reason;
-- the hazard's state read off them; a hazard closes only once controlled; the labourer reads their own.
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
  ('00000000-0000-0000-ac69-000000000001', 'sup69@example.com'),
  ('00000000-0000-0000-ac69-000000000002', 'lh69@example.com'),
  ('00000000-0000-0000-ac69-000000000003', 'lab69@example.com'),
  ('00000000-0000-0000-ac69-000000000004', 'lab69b@example.com');
insert into public.profiles (id, email, full_name) values
  ('00000000-0000-0000-ac69-000000000001', 'sup69@example.com', 'Sue Pervisor'),
  ('00000000-0000-0000-ac69-000000000002', 'lh69@example.com', 'Lee Hand'),
  ('00000000-0000-0000-ac69-000000000003', 'lab69@example.com', 'Sam Labourer'),
  ('00000000-0000-0000-ac69-000000000004', 'lab69b@example.com', 'Other Labourer')
  on conflict (id) do nothing;
insert into public.organisations (id, name, code) values ('aaaaaaaa-0000-0000-ac69-000000000001', 'Kingsbridge Civil', 'KB69');
insert into public.projects (id, org_id, name, code) values ('bbbbbbbb-0000-0000-ac69-000000000001', 'aaaaaaaa-0000-0000-ac69-000000000001', 'Northern', 'C069');
insert into public.project_members (project_id, user_id, role) values
  ('bbbbbbbb-0000-0000-ac69-000000000001', '00000000-0000-0000-ac69-000000000001', 'supervisor'),
  ('bbbbbbbb-0000-0000-ac69-000000000001', '00000000-0000-0000-ac69-000000000002', 'leading_hand'),
  ('bbbbbbbb-0000-0000-ac69-000000000001', '00000000-0000-0000-ac69-000000000003', 'labourer'),
  ('bbbbbbbb-0000-0000-ac69-000000000001', '00000000-0000-0000-ac69-000000000004', 'labourer');

-- 1. The labourer reports a hazard with its type; the type is tidied and then frozen with the first account.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-ac69-000000000003","role":"authenticated"}', true);
set local role authenticated;
insert into public.incidents (id, project_id, kind, occurred_at, description, hazard_type, reported_by)
values ('dddddddd-0000-0000-ac69-000000000001', 'bbbbbbbb-0000-0000-ac69-000000000001', 'hazard', now() - interval '1 hour',
        'Open trench beside the haul road with no barrier', '  excavation ', '00000000-0000-0000-ac69-000000000003');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-ac69-000000000001","role":"authenticated"}', true);
do $$ begin
  assert (select hazard_type from public.incidents where id = 'dddddddd-0000-0000-ac69-000000000001') = 'excavation', 'hazard type not tidied';
  assert public.hazard_control_state('dddddddd-0000-0000-ac69-000000000001') = 'no_controls', 'a fresh hazard has no controls';
end $$;
select tests.expect_error($q$ update public.incidents set hazard_type = 'traffic' where id = 'dddddddd-0000-0000-ac69-000000000001' $q$, 'first account');
do $$ begin raise notice 'PASS  1 hazard type is part of the frozen first account'; end $$;

-- 2. Critical risk: a manager sets it while open; the crew cannot (RLS on the report).
update public.incidents set critical_risk = true where id = 'dddddddd-0000-0000-ac69-000000000001';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-ac69-000000000002","role":"authenticated"}', true);
do $$ declare n int; begin
  update public.incidents set critical_risk = false where id = 'dddddddd-0000-0000-ac69-000000000001';
  get diagnostics n = row_count;
  assert n = 0, 'the leading hand changed the critical flag';
end $$;
-- 3. A hazard does not close with nothing in place.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-ac69-000000000001","role":"authenticated"}', true);
select tests.expect_error($q$ update public.incidents set status = 'closed' where id = 'dddddddd-0000-0000-ac69-000000000001' $q$, 'control is in place');
do $$ begin raise notice 'PASS  2-3 critical risk is the manager''s; a hazard will not close uncontrolled'; end $$;

-- 4. The leading hand plans a control, then puts one in place; the database stamps it; the state follows.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-ac69-000000000002","role":"authenticated"}', true);
insert into public.hazard_controls (id, incident_id, level, description, status, created_by, in_place_at)
values ('cccccccc-0000-0000-ac69-000000000001', 'dddddddd-0000-0000-ac69-000000000001', 'engineering', '  Water-filled barriers along the trench edge ', 'planned', '00000000-0000-0000-ac69-000000000002', now());
do $$ declare c record; begin
  select * into c from public.hazard_controls where id = 'cccccccc-0000-0000-ac69-000000000001';
  assert c.description = 'Water-filled barriers along the trench edge' and c.in_place_at is null and c.status = 'planned', 'planned control not tidied or wrongly stamped';
  assert public.hazard_control_state('dddddddd-0000-0000-ac69-000000000001') = 'control_pending', 'a planned control is pending';
end $$;
select tests.expect_error($q$
  insert into public.hazard_controls (incident_id, level, description, status, created_by)
  values ('dddddddd-0000-0000-ac69-000000000001', 'ppe', 'x', 'withdrawn', '00000000-0000-0000-ac69-000000000002')
$q$, 'not born withdrawn');
insert into public.hazard_controls (id, incident_id, level, description, status, created_by)
values ('cccccccc-0000-0000-ac69-000000000002', 'dddddddd-0000-0000-ac69-000000000001', 'administrative', 'Spotter and exclusion zone until barriers arrive', 'in_place', '00000000-0000-0000-ac69-000000000002');
do $$ declare c record; begin
  select * into c from public.hazard_controls where id = 'cccccccc-0000-0000-ac69-000000000002';
  assert c.in_place_at is not null and c.in_place_by = '00000000-0000-0000-ac69-000000000002', 'in place not stamped';
  assert public.hazard_control_state('dddddddd-0000-0000-ac69-000000000001') = 'controlled', 'one in place is controlled';
end $$;
-- The planned one goes in; its wording may change until then.
update public.hazard_controls set description = 'Water-filled barriers along the full trench edge' where id = 'cccccccc-0000-0000-ac69-000000000001';
update public.hazard_controls set status = 'in_place' where id = 'cccccccc-0000-0000-ac69-000000000001';
select tests.expect_error($q$ update public.hazard_controls set description = 'reworded' where id = 'cccccccc-0000-0000-ac69-000000000001' $q$, 'does not change');
select tests.expect_error($q$ update public.hazard_controls set status = 'planned' where id = 'cccccccc-0000-0000-ac69-000000000001' $q$, 'does not go back');
select tests.expect_error($q$ update public.hazard_controls set status = 'withdrawn' where id = 'cccccccc-0000-0000-ac69-000000000001' $q$, 'say why');
-- The delete policy filters an in-place row to nothing for a signed-in account; the trigger's refusal is proven as the service role.
reset role;
select tests.expect_error($q$ delete from public.hazard_controls where id = 'cccccccc-0000-0000-ac69-000000000002' $q$, 'not removed');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-ac69-000000000002","role":"authenticated"}', true);
do $$ begin raise notice 'PASS  4 controls planned and put in place, stamped, frozen once in'; end $$;

-- 5. Withdrawn with a reason, then frozen; the state falls back to what remains.
update public.hazard_controls set status = 'withdrawn', withdrawn_reason = 'Barriers in; spotter stood down' where id = 'cccccccc-0000-0000-ac69-000000000002';
do $$ declare c record; begin
  select * into c from public.hazard_controls where id = 'cccccccc-0000-0000-ac69-000000000002';
  assert c.withdrawn_at is not null and c.withdrawn_by = '00000000-0000-0000-ac69-000000000002', 'withdrawal not stamped';
  assert public.hazard_control_state('dddddddd-0000-0000-ac69-000000000001') = 'controlled', 'the barriers still control it';
end $$;
select tests.expect_error($q$ update public.hazard_controls set withdrawn_reason = 'changed' where id = 'cccccccc-0000-0000-ac69-000000000002' $q$, 'withdrawn control is frozen');
-- Eliminated: an elimination control in place.
insert into public.hazard_controls (incident_id, level, description, status, created_by)
values ('dddddddd-0000-0000-ac69-000000000001', 'elimination', 'Trench backfilled', 'in_place', '00000000-0000-0000-ac69-000000000002');
do $$ begin
  assert public.hazard_control_state('dddddddd-0000-0000-ac69-000000000001') = 'eliminated', 'elimination in place is eliminated';
  raise notice 'PASS  5 withdrawn with a reason, then frozen; eliminated when an elimination control is in';
end $$;

-- 6. The labourer reads the controls on their own report and none on another's; cannot add one.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-ac69-000000000003","role":"authenticated"}', true);
do $$ begin
  assert (select count(*) from public.hazard_controls where incident_id = 'dddddddd-0000-0000-ac69-000000000001') = 3, 'the reporter reads the controls on their report';
end $$;
select tests.expect_error($q$
  insert into public.hazard_controls (incident_id, level, description, created_by)
  values ('dddddddd-0000-0000-ac69-000000000001', 'ppe', 'Hi-vis', '00000000-0000-0000-ac69-000000000003')
$q$, 'row-level security');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-ac69-000000000004","role":"authenticated"}', true);
do $$ begin
  assert (select count(*) from public.hazard_controls) = 0, 'another labourer reads none';
  raise notice 'PASS  6 the labourer reads their own report''s controls and writes none';
end $$;

-- 7. A planned control is removed by its author alone; then the hazard closes, and takes no more.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-ac69-000000000002","role":"authenticated"}', true);
insert into public.hazard_controls (id, incident_id, level, description, created_by)
values ('cccccccc-0000-0000-ac69-000000000009', 'dddddddd-0000-0000-ac69-000000000001', 'ppe', 'Maybe hi-vis', '00000000-0000-0000-ac69-000000000002');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-ac69-000000000001","role":"authenticated"}', true);
do $$ declare n int; begin
  delete from public.hazard_controls where id = 'cccccccc-0000-0000-ac69-000000000009';
  get diagnostics n = row_count;
  assert n = 0, 'the supervisor removed someone else''s planned control';
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-ac69-000000000002","role":"authenticated"}', true);
delete from public.hazard_controls where id = 'cccccccc-0000-0000-ac69-000000000009';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-ac69-000000000001","role":"authenticated"}', true);
update public.incidents set status = 'closed' where id = 'dddddddd-0000-0000-ac69-000000000001';
select tests.expect_error($q$
  insert into public.hazard_controls (incident_id, level, description, created_by)
  values ('dddddddd-0000-0000-ac69-000000000001', 'ppe', 'late', '00000000-0000-0000-ac69-000000000001')
$q$, 'closed report takes no more controls');
select tests.expect_error($q$ update public.incidents set critical_risk = false where id = 'dddddddd-0000-0000-ac69-000000000001' $q$, 'closed report is frozen');
do $$ begin
  assert (select status from public.incidents where id = 'dddddddd-0000-0000-ac69-000000000001') = 'closed', 'a controlled hazard closes';
  raise notice 'PASS  7 a planned control is its author''s to remove; the controlled hazard closes and freezes';
end $$;

-- 8. A near miss closes without a control — the rule is the hazard's.
insert into public.incidents (id, project_id, kind, occurred_at, description, reported_by)
values ('dddddddd-0000-0000-ac69-000000000002', 'bbbbbbbb-0000-0000-ac69-000000000001', 'near_miss', now() - interval '1 hour', 'Reversing truck, nobody near', '00000000-0000-0000-ac69-000000000001');
update public.incidents set status = 'closed' where id = 'dddddddd-0000-0000-ac69-000000000002';
do $$ begin
  assert (select status from public.incidents where id = 'dddddddd-0000-0000-ac69-000000000002') = 'closed', 'a near miss closes as before';
  raise notice 'PASS  8 the close rule is the hazard''s alone';
end $$;

rollback;
