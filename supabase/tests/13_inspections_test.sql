-- Inspections: born open, signed only over answers and from its own folder,
-- then frozen; actions gate nothing here but are stamped and kept.
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

-- The supervisor keeps templates; the leading hand may not.
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
set local role authenticated;
select tests.expect_error($q$
  insert into public.inspection_templates (org_id, name, items) values ('aaaaaaaa-0000-0000-0000-000000000001', 'LH template', '[]'::jsonb)
$q$, 'row-level security');

-- The leading hand walks an inspection.
insert into public.inspections (id, project_id, template_name, kind, inspection_date, inspector_name, items, conducted_by, signature_path, completed_at)
values ('dddddddd-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', ' Weekly site walk ', 'site', current_date, 'Kel Brady',
        '[{"key":"a","label":"Housekeeping","result":null},{"key":"b","label":"Edges","result":null}]'::jsonb,
        '22222222-2222-2222-2222-222222222222', 'x/y/z.png', now());
do $$ declare i public.inspections; begin
  select * into i from public.inspections where id = 'dddddddd-0000-0000-0000-000000000001';
  assert i.completed_at is null and i.signature_path is null, 'an inspection was born signed';
  assert i.template_name = 'Weekly site walk', 'the template name was not trimmed';
  raise notice 'PASS  an inspection is born open';
end $$;
-- Signing with nothing answered: refused. Signing from the wrong folder: refused.
select tests.expect_error($q$
  update public.inspections set signature_path = 'bbbbbbbb-0000-0000-0000-000000000001/inspection/dddddddd-0000-0000-0000-000000000001/signature.png'
   where id = 'dddddddd-0000-0000-0000-000000000001'
$q$, 'no item has an answer');
update public.inspections set items = '[{"key":"a","label":"Housekeeping","result":"ok"},{"key":"b","label":"Edges","result":"issue","note":"Barrier down at ch 120","photo_urls":["bbbbbbbb-0000-0000-0000-000000000001/inspection/dddddddd-0000-0000-0000-000000000001/p.jpg"]}]'::jsonb
 where id = 'dddddddd-0000-0000-0000-000000000001';
select tests.expect_error($q$
  update public.inspections set signature_path = 'bbbbbbbb-0000-0000-0000-000000000001/prestart/x/sig.png' where id = 'dddddddd-0000-0000-0000-000000000001'
$q$, 'own folder');
update public.inspections set signature_path = 'bbbbbbbb-0000-0000-0000-000000000001/inspection/dddddddd-0000-0000-0000-000000000001/signature.png',
       completed_on_device_at = ((current_date::timestamp + interval '10 hours 5 minutes') at time zone 'Australia/Perth')
 where id = 'dddddddd-0000-0000-0000-000000000001';
do $$ declare i public.inspections; begin
  select * into i from public.inspections where id = 'dddddddd-0000-0000-0000-000000000001';
  assert i.completed_at >= now() - interval '1 minute', 'the signature did not complete it';
  assert i.completed_on_device_at = ((current_date::timestamp + interval '10 hours 5 minutes') at time zone 'Australia/Perth'), 'the phone''s time was lost';
  raise notice 'PASS  the signature completes it, over answers, from its own folder';
end $$;
-- Frozen: the policy withholds the row (zero rows); the trigger refuses anyone who is let through.
update public.inspections set summary = 'changed' where id = 'dddddddd-0000-0000-0000-000000000001';
do $$ begin
  assert (select summary from public.inspections where id = 'dddddddd-0000-0000-0000-000000000001') is null, 'a signed inspection was edited';
end $$;
reset role;
select tests.expect_error($q$
  update public.inspections set summary = 'changed' where id = 'dddddddd-0000-0000-0000-000000000001'
$q$, 'signed and frozen');
do $$ begin raise notice 'PASS  a signed inspection is frozen'; end $$;

-- Actions attach only to a signed inspection; an open one belongs to whoever started it.
reset role;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;
insert into public.inspections (id, project_id, template_name, inspection_date, inspector_name, items, conducted_by)
values ('dddddddd-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000001', 'Open walk', current_date, 'Sup',
        '[{"key":"a","label":"A","result":"issue"}]'::jsonb, '11111111-1111-1111-1111-111111111111');
select tests.expect_error($q$
  insert into public.inspection_actions (inspection_id, action, created_by)
  values ('dddddddd-0000-0000-0000-000000000002', 'Too early', '11111111-1111-1111-1111-111111111111')
$q$, 'signed inspection');
select tests.expect_error($q$
  insert into public.inspections (project_id, template_name, inspection_date, inspector_name, conducted_by)
  values ('bbbbbbbb-0000-0000-0000-000000000001', 'Future walk', current_date + 30, 'Sup', '11111111-1111-1111-1111-111111111111')
$q$, 'within the last year');
reset role;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
set local role authenticated;
update public.inspections set summary = 'LH was here' where id = 'dddddddd-0000-0000-0000-000000000002';
do $$ begin
  assert (select summary from public.inspections where id = 'dddddddd-0000-0000-0000-000000000002') is null, 'another leading hand edited an open inspection';
  raise notice 'PASS  an open inspection is its starter''s; actions need a signature; dates are bounded';
end $$;
reset role;

-- The leading hand may not add actions; the supervisor may, and done is stamped and kept.
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
set local role authenticated;
select tests.expect_error($q$
  insert into public.inspection_actions (inspection_id, item_key, action, created_by)
  values ('dddddddd-0000-0000-0000-000000000001', 'b', 'Reinstate barrier', '22222222-2222-2222-2222-222222222222')
$q$, 'row-level security');
reset role;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;
insert into public.inspection_actions (id, inspection_id, item_key, action, owner_name, due_on, created_by, done_at)
values ('eeeeeeee-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001', 'b', 'Reinstate barrier', 'Matty', current_date + 1, '11111111-1111-1111-1111-111111111111', now());
do $$ begin
  assert (select done_at from public.inspection_actions where id = 'eeeeeeee-0000-0000-0000-000000000001') is null, 'an action was born done';
end $$;
update public.inspection_actions set done_at = timestamptz '2000-01-01', done_note = 'Barrier back up' where id = 'eeeeeeee-0000-0000-0000-000000000001';
do $$ declare a public.inspection_actions; begin
  select * into a from public.inspection_actions where id = 'eeeeeeee-0000-0000-0000-000000000001';
  assert a.done_at >= now() - interval '1 minute' and a.done_by = '11111111-1111-1111-1111-111111111111', 'done was not stamped';
end $$;
reset role;
select tests.expect_error($q$
  delete from public.inspection_actions where id = 'eeeeeeee-0000-0000-0000-000000000001'
$q$, 'part of the record');
do $$ begin raise notice 'PASS  actions are stamped by the database and kept once done'; end $$;

-- The PM reads and writes nothing.
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  assert (select count(*) from public.inspections) = 2, 'the PM cannot read inspections';
end $$;
select tests.expect_error($q$
  insert into public.inspections (project_id, template_name, inspection_date, inspector_name, conducted_by)
  values ('bbbbbbbb-0000-0000-0000-000000000001', 'PM walk', current_date, 'PM', '33333333-3333-3333-3333-333333333333')
$q$, 'row-level security');
do $$ begin raise notice 'PASS  the PM reads and cannot write'; end $$;
reset role;
select set_config('request.jwt.claims', '', true);

do $$ begin raise notice 'ALL INSPECTION TESTS PASSED'; end $$;
rollback;
