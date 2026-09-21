-- A filed SWMS is complete on its own terms and frozen once in use; a labourer reads an active SWMS on their job
-- and signs on to it as themselves — and as nobody else; drafts stay locked to them.
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

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-4444-0000-0000-000000000001', 'sup.swms@example.com', '{"full_name":"Sup Writer"}'),
  ('11111111-4444-0000-0000-000000000002', 'lab.swms@example.com', '{"full_name":"Lab Signer"}');
insert into public.organisations (id, name, code) values ('aaaaaaaa-4444-0000-0000-000000000001', 'Swms Civil', 'SWC');
insert into public.projects (id, org_id, name, code) values ('bbbbbbbb-4444-0000-0000-000000000001', 'aaaaaaaa-4444-0000-0000-000000000001', 'Swms Job', 'W001');
insert into public.project_members (project_id, user_id, role) values
  ('bbbbbbbb-4444-0000-0000-000000000001', '11111111-4444-0000-0000-000000000001', 'supervisor'),
  ('bbbbbbbb-4444-0000-0000-000000000001', '11111111-4444-0000-0000-000000000002', 'labourer');
-- Signature files, as the phones would have put them (storage RLS is the bucket's business, not this suite's).
insert into storage.objects (bucket_id, name) values
  ('entry-photos', 'bbbbbbbb-4444-0000-0000-000000000001/swms/cccccccc-4444-0000-0000-000000000001/sig-lab.png'),
  ('entry-photos', 'bbbbbbbb-4444-0000-0000-000000000001/swms/cccccccc-4444-0000-0000-000000000001/sig-other.png'),
  ('entry-photos', 'bbbbbbbb-4444-0000-0000-000000000001/swms/cccccccc-4444-0000-0000-000000000001/sig-sup.png');

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-4444-0000-0000-000000000001","role":"authenticated"}';

-- The supervisor files the SWMS they already have. No steps, no HRCW: the document is the method statement.
insert into public.swms (id, project_id, kind, title, file_path, file_name, prepared_by, created_by)
values ('cccccccc-4444-0000-0000-000000000001', 'bbbbbbbb-4444-0000-0000-000000000001', 'swms', 'Trenching beside live services',
        'bbbbbbbb-4444-0000-0000-000000000001/cccccccc-4444-0000-0000-000000000001.pdf', ' SWMS-07 trenching.pdf ', 'Sup Writer', '11111111-4444-0000-0000-000000000001');
do $$
declare r public.swms;
begin
  select * into r from public.swms where id = 'cccccccc-4444-0000-0000-000000000001';
  if r.status <> 'draft' then raise exception 'TESTFAIL: born % rather than a draft', r.status; end if;
  if r.file_name <> 'SWMS-07 trenching.pdf' then raise exception 'TESTFAIL: file name not tidied, got "%"', r.file_name; end if;
  if coalesce(array_length(app.swms_problems(r), 1), 0) <> 0 then raise exception 'TESTFAIL: a filed SWMS should have no problems: %', app.swms_problems(r); end if;
end; $$;

-- A file outside the job's folder is refused.
select tests.expect_error($$
  insert into public.swms (project_id, kind, title, file_path, created_by)
  values ('bbbbbbbb-4444-0000-0000-000000000001', 'swms', 'Wrong folder', 'aaaaaaaa-4444-0000-0000-000000000001/x.pdf', '11111111-4444-0000-0000-000000000001')
$$, 'own folder');

-- Put into use straight away — nothing more is asked of it.
update public.swms set status = 'active' where id = 'cccccccc-4444-0000-0000-000000000001';

-- And a second, still a draft, with no file — the labourer must not see it.
insert into public.swms (id, project_id, kind, title, created_by)
values ('cccccccc-4444-0000-0000-000000000002', 'bbbbbbbb-4444-0000-0000-000000000001', 'swms', 'Still being written', '11111111-4444-0000-0000-000000000001');

-- Frozen once in use: the document cannot be swapped. As the service role, which bypasses every
-- policy — under RLS the statement reaches no row and succeeds quietly, which proves nothing.
reset role;
select tests.expect_error($$
  update public.swms set file_path = 'bbbbbbbb-4444-0000-0000-000000000001/cccccccc-4444-0000-0000-000000000001.other.pdf' where id = 'cccccccc-4444-0000-0000-000000000001'
$$, 'not changed');
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-4444-0000-0000-000000000001","role":"authenticated"}';

-- The supervisor signs the crew on as before.
insert into public.swms_signons (swms_id, attendee_name, signature_path, created_by)
values ('cccccccc-4444-0000-0000-000000000001', 'Evan Burke', 'bbbbbbbb-4444-0000-0000-000000000001/swms/cccccccc-4444-0000-0000-000000000001/sig-sup.png', '11111111-4444-0000-0000-000000000001');

-- ---------------------------------------------------------------------------
-- The labourer: reads the active SWMS, not the draft; signs on as themselves and as nobody else.
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"11111111-4444-0000-0000-000000000002","role":"authenticated"}';
do $$
declare n integer;
begin
  select count(*) into n from public.swms where project_id = 'bbbbbbbb-4444-0000-0000-000000000001' and status = 'active';
  if n <> 1 then raise exception 'TESTFAIL: the labourer should read the active SWMS on their job, read %', n; end if;
  select count(*) into n from public.swms where id = 'cccccccc-4444-0000-0000-000000000002';
  if n <> 0 then raise exception 'TESTFAIL: the labourer read a draft'; end if;
end; $$;

-- As somebody else: refused.
select tests.expect_error($$
  insert into public.swms_signons (swms_id, attendee_name, signature_path, created_by)
  values ('cccccccc-4444-0000-0000-000000000001', 'Marcus Hayden', 'bbbbbbbb-4444-0000-0000-000000000001/swms/cccccccc-4444-0000-0000-000000000001/sig-other.png', '11111111-4444-0000-0000-000000000002')
$$, 'row-level security');

-- As themselves, however the name is spaced: recorded.
insert into public.swms_signons (swms_id, attendee_name, signature_path, created_by)
values ('cccccccc-4444-0000-0000-000000000001', '  lab   signer ', 'bbbbbbbb-4444-0000-0000-000000000001/swms/cccccccc-4444-0000-0000-000000000001/sig-lab.png', '11111111-4444-0000-0000-000000000002');

-- And they see their own sign-on, and nobody else's.
do $$
declare n integer; own integer;
begin
  select count(*) into n from public.swms_signons where swms_id = 'cccccccc-4444-0000-0000-000000000001';
  select count(*) into own from public.swms_signons where swms_id = 'cccccccc-4444-0000-0000-000000000001' and created_by = '11111111-4444-0000-0000-000000000002';
  if own <> 1 then raise exception 'TESTFAIL: the labourer cannot see their own sign-on'; end if;
  if n <> 1 then raise exception 'TESTFAIL: the labourer read % sign-ons; only their own is theirs', n; end if;
end; $$;

-- Once per version, as ever.
select tests.expect_error($$
  insert into public.swms_signons (swms_id, attendee_name, signature_path, created_by)
  values ('cccccccc-4444-0000-0000-000000000001', 'Lab Signer', 'bbbbbbbb-4444-0000-0000-000000000001/swms/cccccccc-4444-0000-0000-000000000001/sig-lab.png', '11111111-4444-0000-0000-000000000002')
$$, 'swms_signons_one_per_person_idx');

-- The supervisor sees both sign-ons.
set local request.jwt.claims = '{"sub":"11111111-4444-0000-0000-000000000001","role":"authenticated"}';
do $$
declare n integer;
begin
  select count(*) into n from public.swms_signons where swms_id = 'cccccccc-4444-0000-0000-000000000001';
  if n <> 2 then raise exception 'TESTFAIL: the supervisor should see both sign-ons, saw %', n; end if;
end; $$;

rollback;
