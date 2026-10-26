-- Progress photos from the crew (README R172): a leading hand writes a row for their job's day in its folder; the
-- row is frozen; a labourer reads none; another job reads none; never a date in the future or a foreign folder.
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
  ('11111111-ee63-0000-0000-000000000001', 'lh.dp@example.com'),
  ('11111111-ee63-0000-0000-000000000002', 'lab.dp@example.com'),
  ('11111111-ee63-0000-0000-000000000003', 'other.dp@example.com');
insert into public.organisations (id, name, code) values ('aaaaaaaa-ee63-0000-0000-000000000001', 'Photo Civil', 'DPC');
insert into public.projects (id, org_id, name, code) values
  ('bbbbbbbb-ee63-0000-0000-000000000001', 'aaaaaaaa-ee63-0000-0000-000000000001', 'Photo Job', 'X631'),
  ('bbbbbbbb-ee63-0000-0000-000000000002', 'aaaaaaaa-ee63-0000-0000-000000000001', 'Other Job', 'X632');
insert into public.project_members (project_id, user_id, role) values
  ('bbbbbbbb-ee63-0000-0000-000000000001', '11111111-ee63-0000-0000-000000000001', 'leading_hand'),
  ('bbbbbbbb-ee63-0000-0000-000000000001', '11111111-ee63-0000-0000-000000000002', 'labourer'),
  ('bbbbbbbb-ee63-0000-0000-000000000002', '11111111-ee63-0000-0000-000000000003', 'supervisor');

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-ee63-0000-0000-000000000001","role":"authenticated"}';

insert into public.day_photos (id, project_id, taken_on, url, caption) values
  ('dddddddd-ee63-0000-0000-000000000001', 'bbbbbbbb-ee63-0000-0000-000000000001', '2026-10-26', 'bbbbbbbb-ee63-0000-0000-000000000001/day/2026-10-26/one.jpg', '  Zone 3 subgrade  ');
do $$
declare r public.day_photos;
begin
  select * into r from public.day_photos where id = 'dddddddd-ee63-0000-0000-000000000001';
  if r.caption <> 'Zone 3 subgrade' then raise exception 'TESTFAIL: caption not tidied'; end if;
  if r.added_by <> '11111111-ee63-0000-0000-000000000001' then raise exception 'TESTFAIL: added_by not the caller'; end if;
end; $$;

-- The folder is the job's and the day's; nothing is taken in the future; the row is frozen.
select tests.expect_error(
  $q$insert into public.day_photos (project_id, taken_on, url) values ('bbbbbbbb-ee63-0000-0000-000000000001', '2026-10-26', 'bbbbbbbb-ee63-0000-0000-000000000001/day/2026-10-25/two.jpg')$q$,
  'folder');
select tests.expect_error(
  $q$insert into public.day_photos (project_id, taken_on, url) values ('bbbbbbbb-ee63-0000-0000-000000000001', '2027-01-01', 'bbbbbbbb-ee63-0000-0000-000000000001/day/2027-01-01/two.jpg')$q$,
  'future');
-- No update or delete policy: a user's UPDATE or DELETE touches no row (and the trigger refuses the service role too).
do $$
declare n integer;
begin
  update public.day_photos set caption = 'changed' where id = 'dddddddd-ee63-0000-0000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'TESTFAIL: a day photo was changed'; end if;
  delete from public.day_photos where id = 'dddddddd-ee63-0000-0000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'TESTFAIL: a day photo was deleted'; end if;
end; $$;
-- Not onto another job.
select tests.expect_error(
  $q$insert into public.day_photos (project_id, taken_on, url) values ('bbbbbbbb-ee63-0000-0000-000000000002', '2026-10-26', 'bbbbbbbb-ee63-0000-0000-000000000002/day/2026-10-26/x.jpg')$q$,
  'row-level security');

-- The labourer writes none and reads none; another job's supervisor reads none.
set local request.jwt.claims = '{"sub":"11111111-ee63-0000-0000-000000000002","role":"authenticated"}';
select tests.expect_error(
  $q$insert into public.day_photos (project_id, taken_on, url) values ('bbbbbbbb-ee63-0000-0000-000000000001', '2026-10-26', 'bbbbbbbb-ee63-0000-0000-000000000001/day/2026-10-26/l.jpg')$q$,
  'row-level security');
do $$
begin
  if (select count(*) from public.day_photos) <> 0 then raise exception 'TESTFAIL: the labourer read the day photos'; end if;
end; $$;
set local request.jwt.claims = '{"sub":"11111111-ee63-0000-0000-000000000003","role":"authenticated"}';
do $$
begin
  if (select count(*) from public.day_photos) <> 0 then raise exception 'TESTFAIL: another job read the day photos'; end if;
end; $$;

rollback;
