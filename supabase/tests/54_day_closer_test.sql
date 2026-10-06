-- Who closes the day (README R126): a job that names its closer takes nobody else's closing signature, says so by
-- name, and still lets the supervisor edit and hand the day over; a job that names nobody works as before; the
-- closer must hold the job; the hand-over stamp is the database's and is not in the hash.
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
  ('11111111-5454-0000-0000-000000000001', 'owner.dc@example.com'),
  ('11111111-5454-0000-0000-000000000002', 'sup.dc@example.com'),
  ('11111111-5454-0000-0000-000000000003', 'other.dc@example.com');
update public.profiles set full_name = 'Owner Person' where id = '11111111-5454-0000-0000-000000000001';
insert into public.organisations (id, name, code) values ('aaaaaaaa-5454-0000-0000-000000000001', 'Closer Civil', 'CLC');
insert into public.projects (id, org_id, name, code) values
  ('bbbbbbbb-5454-0000-0000-000000000001', 'aaaaaaaa-5454-0000-0000-000000000001', 'Closer Job', 'D541'),
  ('bbbbbbbb-5454-0000-0000-000000000002', 'aaaaaaaa-5454-0000-0000-000000000001', 'Open Job', 'D542');
insert into public.project_members (project_id, user_id, role) values
  ('bbbbbbbb-5454-0000-0000-000000000001', '11111111-5454-0000-0000-000000000001', 'admin'),
  ('bbbbbbbb-5454-0000-0000-000000000001', '11111111-5454-0000-0000-000000000002', 'supervisor'),
  ('bbbbbbbb-5454-0000-0000-000000000002', '11111111-5454-0000-0000-000000000001', 'admin'),
  ('bbbbbbbb-5454-0000-0000-000000000002', '11111111-5454-0000-0000-000000000002', 'supervisor');

-- The closer must hold the job.
select tests.expect_error($$ update public.projects set day_closer_id = '11111111-5454-0000-0000-000000000003' where id = 'bbbbbbbb-5454-0000-0000-000000000001' $$, 'must be a member');
update public.projects set day_closer_id = '11111111-5454-0000-0000-000000000001' where id = 'bbbbbbbb-5454-0000-0000-000000000001';

-- Two drafts by the supervisor, one on each job, each complete enough to sign.
insert into public.entries (id, project_id, entry_date, author_id) values
  ('cccccccc-5454-0000-0000-000000000001', 'bbbbbbbb-5454-0000-0000-000000000001', date '2026-10-01', '11111111-5454-0000-0000-000000000002'),
  ('cccccccc-5454-0000-0000-000000000002', 'bbbbbbbb-5454-0000-0000-000000000002', date '2026-10-01', '11111111-5454-0000-0000-000000000002');
insert into public.labour (entry_id, person_name, role, hours, source_quote, confidence) values
  ('cccccccc-5454-0000-0000-000000000001', 'Sam Whitely', 'labourer', 8, 'Sam all day', 'high'),
  ('cccccccc-5454-0000-0000-000000000002', 'Sam Whitely', 'labourer', 8, 'Sam all day', 'high');

set local role authenticated;
-- The supervisor edits the draft and hands it over; the database stamps the hand-over.
set local request.jwt.claims = '{"sub":"11111111-5454-0000-0000-000000000002","role":"authenticated"}';
update public.entries set notes = 'All done for the day' where id = 'cccccccc-5454-0000-0000-000000000001';
update public.entries set ready_at = '2020-01-01T00:00:00Z', ready_by = '11111111-5454-0000-0000-000000000003', ready_note = '  Please check the hours  ' where id = 'cccccccc-5454-0000-0000-000000000001';
do $$
declare r public.entries;
begin
  select * into r from public.entries where id = 'cccccccc-5454-0000-0000-000000000001';
  if r.ready_at < now() - interval '1 minute' then raise exception 'TESTFAIL: ready_at should be stamped now, got %', r.ready_at; end if;
  if r.ready_by <> '11111111-5454-0000-0000-000000000002' then raise exception 'TESTFAIL: ready_by should be the caller'; end if;
  if r.ready_note <> 'Please check the hours' then raise exception 'TESTFAIL: note not tidied'; end if;
end; $$;
-- But the supervisor cannot close it: the job names its closer.
select tests.expect_error($$ update public.entries set status = 'signed' where id = 'cccccccc-5454-0000-0000-000000000001' $$, 'Only Owner Person closes the day');
select tests.expect_error($$ select public.sign_entry('cccccccc-5454-0000-0000-000000000001', '{}'::jsonb) $$, 'Only Owner Person closes the day');
-- On the job that names nobody, the supervisor signs as before.
update public.entries set status = 'signed' where id = 'cccccccc-5454-0000-0000-000000000002';
do $$ begin if (select signed_by from public.entries where id = 'cccccccc-5454-0000-0000-000000000002') <> '11111111-5454-0000-0000-000000000002' then raise exception 'TESTFAIL: the supervisor should sign on a job with no closer'; end if; end; $$;

-- The closer signs; the hand-over stamp stays on the row and is not in the hash.
set local request.jwt.claims = '{"sub":"11111111-5454-0000-0000-000000000001","role":"authenticated"}';
update public.entries set status = 'signed' where id = 'cccccccc-5454-0000-0000-000000000001';
do $$
declare r public.entries;
begin
  select * into r from public.entries where id = 'cccccccc-5454-0000-0000-000000000001';
  if r.status <> 'signed' or r.signed_by <> '11111111-5454-0000-0000-000000000001' then raise exception 'TESTFAIL: the closer should sign'; end if;
  if r.ready_at is null then raise exception 'TESTFAIL: the hand-over should stay on the record'; end if;
  if app.canonical_entry_json(r)::text like '%ready%' then raise exception 'TESTFAIL: the hand-over must not be in the hash'; end if;
  if r.content_hash <> app.entry_content_hash(r) then raise exception 'TESTFAIL: hash does not verify'; end if;
end; $$;
rollback;
