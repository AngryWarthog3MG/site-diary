-- Document control: versions numbered and superseding under a lock, frozen
-- once issued; acknowledgements of the current version only, once, frozen.
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

select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;
insert into public.controlled_documents (id, org_id, title, kind, doc_number, created_by)
values ('dddddddd-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', '  Working near   services ', 'procedure', ' KBS-WHS-012 ', '11111111-1111-1111-1111-111111111111');
select tests.expect_error($q$
  insert into public.document_versions (document_id, file_path, issued_by)
  values ('dddddddd-0000-0000-0000-000000000001', 'somewhere/else/v1.pdf', '11111111-1111-1111-1111-111111111111')
$q$, 'own folder');
insert into public.document_versions (id, document_id, file_path, summary, issued_by, status, version)
values ('eeeeeeee-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001/dddddddd-0000-0000-0000-000000000001/v1.pdf', 'First issue', '11111111-1111-1111-1111-111111111111', 'superseded', 99);
do $$ declare v public.document_versions; begin
  select * into v from public.document_versions where id = 'eeeeeeee-0000-0000-0000-000000000001';
  assert v.version = 1 and v.status = 'current', 'the first version was not numbered 1 and current';
  assert (select title from public.controlled_documents where id = 'dddddddd-0000-0000-0000-000000000001') = 'Working near services', 'title not trimmed';
  raise notice 'PASS  a version is numbered by the database and issued current';
end $$;

-- The leading hand records an acknowledgement of the current version, once per person.
reset role;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
set local role authenticated;
insert into public.document_acknowledgements (id, version_id, person_name, signature_path, project_id, recorded_by)
values ('ffffffff-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000001', ' Danny  Rowe ', 'bbbbbbbb-0000-0000-0000-000000000001/document/ffffffff-0000-0000-0000-000000000001/sig.png', 'bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222');
select tests.expect_error($q$
  insert into public.document_acknowledgements (id, version_id, person_name, signature_path, project_id, recorded_by)
  values ('ffffffff-0000-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-000000000001', 'danny rowe', 'bbbbbbbb-0000-0000-0000-000000000001/document/ffffffff-0000-0000-0000-000000000002/sig.png', 'bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222')
$q$, 'document_acknowledgements_once_idx');
select tests.expect_error($q$
  insert into public.document_versions (document_id, file_path, issued_by)
  values ('dddddddd-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001/dddddddd-0000-0000-0000-000000000001/lh.pdf', '22222222-2222-2222-2222-222222222222')
$q$, 'row-level security');
do $$ begin raise notice 'PASS  the crew acknowledge once per version; a leading hand does not issue'; end $$;

-- Version 2 supersedes; v1 takes no more acknowledgements; nothing issued or signed changes.
reset role;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;
insert into public.document_versions (id, document_id, file_path, summary, issued_by)
values ('eeeeeeee-0000-0000-0000-000000000002', 'dddddddd-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001/dddddddd-0000-0000-0000-000000000001/v2.pdf', 'Added DBYD step', '11111111-1111-1111-1111-111111111111');
do $$ begin
  assert (select status from public.document_versions where id = 'eeeeeeee-0000-0000-0000-000000000001') = 'superseded', 'v1 was not superseded';
  assert (select version from public.document_versions where id = 'eeeeeeee-0000-0000-0000-000000000002') = 2, 'v2 was not numbered 2';
  assert (select count(*) from public.document_acknowledgements where version_id = 'eeeeeeee-0000-0000-0000-000000000001') = 1, 'v1 lost its acknowledgements';
end $$;
select tests.expect_error($q$
  insert into public.document_acknowledgements (id, version_id, person_name, signature_path, project_id, recorded_by)
  values ('ffffffff-0000-0000-0000-000000000003', 'eeeeeeee-0000-0000-0000-000000000001', 'Sam Whitely', 'bbbbbbbb-0000-0000-0000-000000000001/document/ffffffff-0000-0000-0000-000000000003/sig.png', 'bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111')
$q$, 'superseded');
reset role;
select tests.expect_error($q$
  update public.document_versions set summary = 'edited' where id = 'eeeeeeee-0000-0000-0000-000000000002'
$q$, 'frozen');
select tests.expect_error($q$
  delete from public.document_acknowledgements where id = 'ffffffff-0000-0000-0000-000000000001'
$q$, 'never changed or removed');
do $$ begin raise notice 'PASS  a new version supersedes; the old keeps its signatures and takes no more; nothing is edited'; end $$;

-- The PM reads and writes nothing.
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  assert (select count(*) from public.document_versions) = 2, 'the PM cannot read versions';
end $$;
select tests.expect_error($q$
  insert into public.controlled_documents (org_id, title) values ('aaaaaaaa-0000-0000-0000-000000000001', 'PM doc')
$q$, 'row-level security');
do $$ begin raise notice 'PASS  the PM reads and cannot write'; end $$;
reset role;
select set_config('request.jwt.claims', '', true);

do $$ begin raise notice 'ALL DOCUMENT CONTROL TESTS PASSED'; end $$;
rollback;
