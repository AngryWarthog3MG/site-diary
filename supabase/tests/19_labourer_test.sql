-- The labourer: signs in and out, reports hazards — and nothing else.
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
insert into auth.users (id, email) values ('55555555-5555-5555-5555-555555555555', 'lab@example.com');
insert into public.organisations (id, name, code) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Kingsbridge Civil', 'KBS');
insert into public.projects (id, org_id, name, code) values ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Northern', 'C001');
insert into public.project_members (project_id, user_id, role) values
  ('bbbbbbbb-0000-0000-0000-000000000001', '55555555-5555-5555-5555-555555555555', 'labourer');

select set_config('request.jwt.claims', '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}', true);
set local role authenticated;
-- The two doors open.
insert into public.site_signins (id, project_id, signin_date, person_name, person_kind, signed_in_by)
values ('cccccccc-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', current_date, 'Sam Labourer', 'crew', '55555555-5555-5555-5555-555555555555');
update public.site_signins set signed_out_at = now() where id = 'cccccccc-0000-0000-0000-000000000001';
insert into public.incidents (id, project_id, kind, occurred_at, description, reported_by)
values ('dddddddd-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'hazard', now() - interval '1 hour', 'Loose grate near the compound', '55555555-5555-5555-5555-555555555555');
insert into public.incident_updates (incident_id, body, created_by)
values ('dddddddd-0000-0000-0000-000000000001', 'Coned off', '55555555-5555-5555-5555-555555555555');
do $$ begin
  assert (select signed_out_at from public.site_signins where id = 'cccccccc-0000-0000-0000-000000000001') is not null, 'labourer could not sign out';
  assert (select count(*) from public.incidents) = 1 and (select count(*) from public.incident_updates) = 1, 'labourer could not report';
  raise notice 'PASS  a labourer signs in and out and reports a hazard';
end $$;
-- Every other door is shut.
select tests.expect_error($q$
  insert into public.prestarts (project_id, prestart_date, supervisor_name, work_planned, hazards, conducted_by) values ('bbbbbbbb-0000-0000-0000-000000000001', current_date, 'Sam', 'Dig', 'Services', '55555555-5555-5555-5555-555555555555')
$q$, 'row-level security');
select tests.expect_error($q$
  insert into public.orders (project_id, kind, item, raised_by) values ('bbbbbbbb-0000-0000-0000-000000000001', 'material', 'Diesel', '55555555-5555-5555-5555-555555555555')
$q$, 'row-level security');
select tests.expect_error($q$
  insert into public.inspections (project_id, inspection_date, kind, template_name, inspector_name, conducted_by, items) values ('bbbbbbbb-0000-0000-0000-000000000001', current_date, 'site', 'Site walk', 'Sam', '55555555-5555-5555-5555-555555555555', '[]'::jsonb)
$q$, 'row-level security');
update public.incidents set status = 'closed' where id = 'dddddddd-0000-0000-0000-000000000001';
do $$ begin
  assert (select status from public.incidents where id = 'dddddddd-0000-0000-0000-000000000001') = 'open', 'a labourer closed a report';
  raise notice 'PASS  prestarts, orders, inspections and managing reports are refused';
end $$;
-- The record is not theirs to read: a signed day exists, and the labourer sees none of it.
reset role;
insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111', 'sup@example.com');
insert into public.project_members (project_id, user_id, role) values ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'supervisor');
insert into public.entries (id, project_id, author_id, entry_date, status) values ('eeeeeeee-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', current_date - 1, 'draft');
insert into public.labour (entry_id, person_name, hours) values ('eeeeeeee-0000-0000-0000-000000000001', 'Marcus', 8);
insert into public.orders (project_id, kind, item, raised_by) values ('bbbbbbbb-0000-0000-0000-000000000001', 'material', 'Diesel', '11111111-1111-1111-1111-111111111111');
select set_config('request.jwt.claims', '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  assert (select count(*) from public.entries) = 0, 'a labourer read the diary';
  assert (select count(*) from public.labour) = 0, 'a labourer read labour rows';
  assert (select count(*) from public.orders) = 0, 'a labourer read the orders';
  assert (select count(*) from public.site_signins) = 1, 'a labourer lost the gate';
  assert (select count(*) from public.incidents) = 1, 'a labourer lost the reports';
  assert (select count(*) from public.projects) = 1, 'a labourer lost their job';
  raise notice 'PASS  a labourer reads the gate and the reports, and none of the record';
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  assert (select count(*) from public.entries) = 1 and (select count(*) from public.labour) = 1 and (select count(*) from public.orders) = 1, 'the supervisor lost a read';
  raise notice 'PASS  everyone else reads what they read yesterday';
end $$;
reset role;
select set_config('request.jwt.claims', '', true);
do $$ begin raise notice 'ALL LABOURER TESTS PASSED'; end $$;
rollback;
