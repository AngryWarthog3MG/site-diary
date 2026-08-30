-- ============================================================================
-- supabase/tests/08_settings_test.sql
--
--   * an admin can rename a project and fix its coordinates
--   * codes are editable until the first signature and fixed after
--   * a project cannot be moved between organisations
--   * a supervisor cannot edit the project at all
-- ============================================================================

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
  ('11111111-1111-1111-1111-111111111111', 'admin@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'sup@example.com');

insert into public.organisations (id, name, code) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Kingsbridge Civil', 'KBS'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'Somebody Else', 'SEL');

insert into public.projects (id, org_id, name, code)
values ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
        'Provisional Name', 'T001');

insert into public.project_members (project_id, user_id, role) values
  ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'admin'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'supervisor');

select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;

-- ---------------------------------------------------------------------------
-- 1. Before anything is signed, everything is editable
-- ---------------------------------------------------------------------------
do $$
declare s jsonb;
begin
  s := public.project_settings_state('bbbbbbbb-0000-0000-0000-000000000001');
  assert (s ->> 'can_edit')::boolean, 'an admin cannot edit their own project';
  assert not (s ->> 'code_locked')::boolean, 'codes locked with nothing signed';
  assert (s ->> 'signed_entries')::int = 0, 'unexpected signed entries';
end;
$$;

update public.projects
   set name = 'Northern Interchange Stage 2',
       code = 'C001',
       site_lat = -31.9523,
       site_lng = 115.8613,
       principal_contractor = 'Lendlease'
 where id = 'bbbbbbbb-0000-0000-0000-000000000001';

update public.organisations set name = 'Kingsbridge Civil Pty Ltd', code = 'KBC'
 where id = 'aaaaaaaa-0000-0000-0000-000000000001';

do $$
begin
  assert (select code from public.projects where id = 'bbbbbbbb-0000-0000-0000-000000000001') = 'C001',
         'project code did not change while it still could';
  assert (select code from public.organisations where id = 'aaaaaaaa-0000-0000-0000-000000000001') = 'KBC',
         'org code did not change while it still could';
  raise notice 'PASS  names, codes and coordinates are editable before the first signature';
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. A project never changes organisation
-- ---------------------------------------------------------------------------
select tests.expect_error($q$
  update public.projects set org_id = 'aaaaaaaa-0000-0000-0000-000000000002'
   where id = 'bbbbbbbb-0000-0000-0000-000000000001'
$q$, 'cannot be moved to another organisation');

do $$ begin raise notice 'PASS  a project cannot be moved between organisations'; end; $$;

-- ---------------------------------------------------------------------------
-- 3. Once an entry is signed, the codes are part of the record
-- ---------------------------------------------------------------------------
insert into public.entries (id, project_id, entry_date, author_id)
values ('cccccccc-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001',
        date '2026-08-25', '11111111-1111-1111-1111-111111111111');
update public.entries set status = 'signed' where id = 'cccccccc-0000-0000-0000-000000000001';

do $$
begin
  assert (select entry_no from public.entries where id = 'cccccccc-0000-0000-0000-000000000001')
         = 'KBC-2026-08-25', 'unexpected entry reference';
end;
$$;

select tests.expect_error($q$
  update public.projects set code = 'C002' where id = 'bbbbbbbb-0000-0000-0000-000000000001'
$q$, 'Project code cannot change');

select tests.expect_error($q$
  update public.organisations set code = 'XXX' where id = 'aaaaaaaa-0000-0000-0000-000000000001'
$q$, 'Organisation code cannot change');

-- Everything else still moves.
update public.projects set name = 'Northern Interchange Stage 2 (South)', site_lat = -31.96
 where id = 'bbbbbbbb-0000-0000-0000-000000000001';
update public.organisations set name = 'Kingsbridge Civil Group'
 where id = 'aaaaaaaa-0000-0000-0000-000000000001';

do $$
declare s jsonb;
begin
  s := public.project_settings_state('bbbbbbbb-0000-0000-0000-000000000001');
  assert (s ->> 'code_locked')::boolean, 'code should be locked after signing';
  assert (s ->> 'org_code_locked')::boolean, 'org code should be locked after signing';
  assert (s ->> 'signed_entries')::int = 1, 'signed count wrong';
  raise notice 'PASS  codes freeze at the first signature; names and coordinates do not';
end;
$$;

reset role;
select set_config('request.jwt.claims', '', true);

-- ---------------------------------------------------------------------------
-- 4. A supervisor cannot edit the project
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
set local role authenticated;

do $$
declare s jsonb; touched integer;
begin
  s := public.project_settings_state('bbbbbbbb-0000-0000-0000-000000000001');
  assert not (s ->> 'can_edit')::boolean, 'a supervisor is offered editing';

  update public.projects set name = 'Renamed by a supervisor'
   where id = 'bbbbbbbb-0000-0000-0000-000000000001';
  get diagnostics touched = row_count;
  assert touched = 0, 'a supervisor edited the project';

  raise notice 'PASS  a supervisor can see the settings but cannot change them';
end;
$$;

reset role;
select set_config('request.jwt.claims', '', true);

do $$ begin raise notice ''; raise notice 'ALL SETTINGS TESTS PASSED'; end; $$;

rollback;
