-- SWMS and JSA: a draft is checked before it is worked to, a version in use
-- is frozen, sign-ons attach only to what is in use and never change.
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
  ('11111111-1111-1111-1111-111111111111', 'sup@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'lh@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'pm@example.com');
insert into public.organisations (id, name, code) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Kingsbridge Civil', 'KBS');
insert into public.projects (id, org_id, name, code) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Northern', 'C001');
insert into public.project_members (project_id, user_id, role) values
  ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'supervisor'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'leading_hand'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'pm');

-- The supervisor writes a SWMS.
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;

insert into public.swms (id, project_id, kind, title, prepared_by, steps, status, activated_at, created_by)
values ('dddddddd-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'swms', '  Trench for water main ', 'Matty',
        '[{"step":"Dig","hazards":"","controls":"Batter the sides"}]'::jsonb, 'active', now(), '11111111-1111-1111-1111-111111111111');
do $$ declare s public.swms; begin
  select * into s from public.swms where id = 'dddddddd-0000-0000-0000-000000000001';
  assert s.status = 'draft' and s.activated_at is null, 'a SWMS was born in use';
  assert s.title = 'Trench for water main', 'the title was not trimmed';
  assert s.version = 1, 'a first version is not version 1';
  raise notice 'PASS  a SWMS is born a draft';
end $$;

-- Not complete: no hazard on step 1, no high-risk category named.
select tests.expect_error($q$
  update public.swms set status = 'active' where id = 'dddddddd-0000-0000-0000-000000000001'
$q$, 'step 1 names no hazard');
update public.swms set hrcw = array['shaft_trench'], steps = '[{"step":"Dig","hazards":"Trench collapse, services","risk_before":"high","controls":"DBYD, pothole, batter or shore","risk_after":"low","who":"Supervisor"}]'::jsonb
 where id = 'dddddddd-0000-0000-0000-000000000001';
update public.swms set status = 'active' where id = 'dddddddd-0000-0000-0000-000000000001';
do $$ declare s public.swms; begin
  select * into s from public.swms where id = 'dddddddd-0000-0000-0000-000000000001';
  assert s.status = 'active' and s.activated_at is not null and s.activated_by = '11111111-1111-1111-1111-111111111111', 'put into use did not stamp';
  raise notice 'PASS  put into use only when complete; the database stamps who and when';
end $$;

-- In use: frozen.
select tests.expect_error($q$
  update public.swms set steps = '[]'::jsonb where id = 'dddddddd-0000-0000-0000-000000000001'
$q$, 'frozen');
select tests.expect_error($q$
  update public.swms set status = 'draft' where id = 'dddddddd-0000-0000-0000-000000000001'
$q$, 'does not become');

-- The leading hand signs the crew on; a signature lives in the SWMS's own folder; once each.
reset role;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
set local role authenticated;
select tests.expect_error($q$
  insert into public.swms_signons (swms_id, attendee_name, signature_path, created_by)
  values ('dddddddd-0000-0000-0000-000000000001', 'Danny Rowe', 'bbbbbbbb-0000-0000-0000-000000000001/prestart/x/sig.png', '22222222-2222-2222-2222-222222222222')
$q$, 'own folder');
insert into public.swms_signons (id, swms_id, attendee_name, signature_path, created_by)
values ('eeeeeeee-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001', ' Danny Rowe ',
        'bbbbbbbb-0000-0000-0000-000000000001/swms/dddddddd-0000-0000-0000-000000000001/sig-1.png', '22222222-2222-2222-2222-222222222222');
select tests.expect_error($q$
  insert into public.swms_signons (swms_id, attendee_name, signature_path, created_by)
  values ('dddddddd-0000-0000-0000-000000000001', 'danny rowe', 'bbbbbbbb-0000-0000-0000-000000000001/swms/dddddddd-0000-0000-0000-000000000001/sig-2.png', '22222222-2222-2222-2222-222222222222')
$q$, 'swms_signons_one_per_person_idx');
-- The leading hand may not write the SWMS itself.
select tests.expect_error($q$
  insert into public.swms (project_id, title, created_by) values ('bbbbbbbb-0000-0000-0000-000000000001', 'LH draft', '22222222-2222-2222-2222-222222222222')
$q$, 'row-level security');
do $$ begin raise notice 'PASS  sign-ons go in the SWMS folder, once per person; a leading hand signs on but does not author'; end $$;

-- A sign-on never changes or goes.
update public.swms_signons set attendee_name = 'Someone Else' where id = 'eeeeeeee-0000-0000-0000-000000000001';
delete from public.swms_signons where id = 'eeeeeeee-0000-0000-0000-000000000001';
do $$ begin
  assert (select attendee_name from public.swms_signons where id = 'eeeeeeee-0000-0000-0000-000000000001') = 'Danny Rowe', 'a sign-on was changed or removed';
end $$;
reset role;
select tests.expect_error($q$
  delete from public.swms_signons where id = 'eeeeeeee-0000-0000-0000-000000000001'
$q$, 'never changed or removed');
do $$ begin raise notice 'PASS  a sign-on is frozen for everyone'; end $$;

-- A revision: version 2 supersedes version 1 when it is put into use; sign-ons stay with version 1.
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;
insert into public.swms (id, project_id, kind, title, prepared_by, hrcw, steps, supersedes_id, created_by)
values ('dddddddd-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000001', 'swms', 'Trench for water main', 'Matty', array['shaft_trench'],
        '[{"step":"Dig","hazards":"Collapse","controls":"Shore"}]'::jsonb, 'dddddddd-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111');
do $$ begin
  assert (select version from public.swms where id = 'dddddddd-0000-0000-0000-000000000002') = 2, 'a revision is not version 2';
  assert (select status from public.swms where id = 'dddddddd-0000-0000-0000-000000000001') = 'active', 'version 1 was superseded by a draft';
end $$;
-- Signing on to the draft revision: refused.
select tests.expect_error($q$
  insert into public.swms_signons (swms_id, attendee_name, signature_path, created_by)
  values ('dddddddd-0000-0000-0000-000000000002', 'Danny Rowe', 'bbbbbbbb-0000-0000-0000-000000000001/swms/dddddddd-0000-0000-0000-000000000002/sig.png', '11111111-1111-1111-1111-111111111111')
$q$, 'in use');
update public.swms set status = 'active' where id = 'dddddddd-0000-0000-0000-000000000002';
do $$ begin
  assert (select status from public.swms where id = 'dddddddd-0000-0000-0000-000000000001') = 'superseded', 'version 1 was not superseded';
  assert (select count(*) from public.swms_signons where swms_id = 'dddddddd-0000-0000-0000-000000000001') = 1, 'version 1 lost its sign-ons';
  raise notice 'PASS  a revision supersedes on activation and keeps the old sign-ons with the old version';
end $$;

-- Lineage is fixed: a draft cannot be re-pointed at another SWMS or job.
insert into public.swms (id, project_id, title, created_by) values ('dddddddd-0000-0000-0000-000000000004', 'bbbbbbbb-0000-0000-0000-000000000001', 'Loose draft', '11111111-1111-1111-1111-111111111111');
select tests.expect_error($q$
  update public.swms set supersedes_id = 'dddddddd-0000-0000-0000-000000000002' where id = 'dddddddd-0000-0000-0000-000000000004'
$q$, 'lineage');
-- Two revisions of v2: only one can be put into use; the other is told to revise the current one.
insert into public.swms (id, project_id, kind, title, prepared_by, hrcw, steps, supersedes_id, created_by)
values ('dddddddd-0000-0000-0000-000000000005', 'bbbbbbbb-0000-0000-0000-000000000001', 'swms', 'Trench for water main', 'Matty', array['shaft_trench'],
        '[{"step":"Dig","hazards":"Collapse","controls":"Shore"}]'::jsonb, 'dddddddd-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111');
insert into public.swms (id, project_id, kind, title, prepared_by, hrcw, steps, supersedes_id, created_by)
values ('dddddddd-0000-0000-0000-000000000006', 'bbbbbbbb-0000-0000-0000-000000000001', 'swms', 'Trench for water main', 'Matty', array['shaft_trench'],
        '[{"step":"Dig","hazards":"Collapse","controls":"Shore"}]'::jsonb, 'dddddddd-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111');
update public.swms set status = 'active' where id = 'dddddddd-0000-0000-0000-000000000005';
select tests.expect_error($q$
  update public.swms set status = 'active' where id = 'dddddddd-0000-0000-0000-000000000006'
$q$, 'no longer in use');
do $$ begin
  assert (select count(*) from public.swms where status = 'active') = 1, 'two versions are in use at once';
  raise notice 'PASS  lineage is fixed and only one revision can take over';
end $$;
-- Frozen dates: created_at and archived_at do not move.
select tests.expect_error($q$
  update public.swms set created_at = now() - interval '1 year' where id = 'dddddddd-0000-0000-0000-000000000005'
$q$, 'birth');
update public.swms set status = 'archived' where id = 'dddddddd-0000-0000-0000-000000000005';
update public.swms set archived_at = now() - interval '1 year' where id = 'dddddddd-0000-0000-0000-000000000005';
do $$ begin
  assert (select archived_at from public.swms where id = 'dddddddd-0000-0000-0000-000000000005') >= now() - interval '1 minute', 'archived_at was moved';
  raise notice 'PASS  a frozen SWMS keeps its dates';
end $$;
-- A revision of archived work cannot become the current SWMS.
select tests.expect_error($q$
  update public.swms set status = 'active' where id = 'dddddddd-0000-0000-0000-000000000006'
$q$, 'no longer in use');
delete from public.swms where id in ('dddddddd-0000-0000-0000-000000000004', 'dddddddd-0000-0000-0000-000000000006');

-- A draft can be deleted; a version in use cannot.
insert into public.swms (id, project_id, title, created_by) values ('dddddddd-0000-0000-0000-000000000003', 'bbbbbbbb-0000-0000-0000-000000000001', 'Scrap', '11111111-1111-1111-1111-111111111111');
delete from public.swms where id = 'dddddddd-0000-0000-0000-000000000003';
delete from public.swms where id = 'dddddddd-0000-0000-0000-000000000002';
do $$ begin
  assert not exists (select 1 from public.swms where id = 'dddddddd-0000-0000-0000-000000000003'), 'a draft could not be deleted';
  assert exists (select 1 from public.swms where id = 'dddddddd-0000-0000-0000-000000000002'), 'a SWMS in use was deleted';
  raise notice 'PASS  drafts go; versions in use stay';
end $$;

-- The PM reads and writes nothing.
reset role;
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  assert (select count(*) from public.swms) = 3, 'the PM cannot read the SWMS list';
  assert (select count(*) from public.swms_signons) = 1, 'the PM cannot read sign-ons';
end $$;
select tests.expect_error($q$
  insert into public.swms (project_id, title, created_by) values ('bbbbbbbb-0000-0000-0000-000000000001', 'PM draft', '33333333-3333-3333-3333-333333333333')
$q$, 'row-level security');
do $$ begin raise notice 'PASS  the PM reads and cannot write'; end $$;
reset role;
select set_config('request.jwt.claims', '', true);

do $$ begin raise notice 'ALL SWMS TESTS PASSED'; end $$;
rollback;
