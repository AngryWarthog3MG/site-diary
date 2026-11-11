-- A photograph comes off a QA record: freely while it is open; on a signed record only one added after sign-off,
-- never one it was signed with, order kept, new ones on the end; every removal kept with which, who, when — the file
-- stays in storage and the row is what names it (README R189).
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

insert into auth.users (id, email) values ('11111111-eeee-0000-0000-000000000001', 'pm.removals@example.com');
insert into public.organisations (id, name, code) values ('aaaaaaaa-eeee-0000-0000-000000000001', 'Removal Civil', 'RMC');
insert into public.projects (id, org_id, name, code) values ('bbbbbbbb-eeee-0000-0000-000000000001', 'aaaaaaaa-eeee-0000-0000-000000000001', 'Removal Job', 'P302');
insert into public.project_members (project_id, user_id, role) values ('bbbbbbbb-eeee-0000-0000-000000000001', '11111111-eeee-0000-0000-000000000001', 'pm');
insert into public.qa_templates (id, org_id, spec, issued_at) values
  ('cccccccc-eeee-0000-0000-000000000001', 'aaaaaaaa-eeee-0000-0000-000000000001',
   '{"code":"KBS-QA-P-002","kind":"itr_checklist","title":"Removal form","revision":"A","sections":[{"title":"A","items":[{"id":"1","text":"x"}]}],"signoffs":[{"party":"KBS","required":true,"kind":"internal"}]}', now());

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-eeee-0000-0000-000000000001","role":"authenticated"}';

-- 1. An open record: photographs come and go freely; the removal is still kept, because the file is.
insert into public.qa_records (id, project_id, template_id, items, lot_or_element, photo_paths) values
  ('dddddddd-eeee-0000-0000-000000000001', 'bbbbbbbb-eeee-0000-0000-000000000001', 'cccccccc-eeee-0000-0000-000000000001',
   '[{"item_id":"1","state":"ok"}]', 'Building 3',
   '{bbbbbbbb-eeee-0000-0000-000000000001/qa/dddddddd-eeee-0000-0000-000000000001/a.jpg,bbbbbbbb-eeee-0000-0000-000000000001/qa/dddddddd-eeee-0000-0000-000000000001/x.jpg}');
update public.qa_records set photo_paths = '{bbbbbbbb-eeee-0000-0000-000000000001/qa/dddddddd-eeee-0000-0000-000000000001/a.jpg}' where id = 'dddddddd-eeee-0000-0000-000000000001';
do $$ begin
  if (select array_length(photo_paths, 1) from public.qa_records where id = 'dddddddd-eeee-0000-0000-000000000001') <> 1 then raise exception 'TESTFAIL: open record drops a photograph'; end if;
  if (select paths from public.qa_record_photo_removals where record_id = 'dddddddd-eeee-0000-0000-000000000001')
     <> '{bbbbbbbb-eeee-0000-0000-000000000001/qa/dddddddd-eeee-0000-0000-000000000001/x.jpg}' then raise exception 'TESTFAIL: the open record''s removal names x.jpg'; end if;
  if (select count(*) from public.qa_record_photo_additions) <> 0 then raise exception 'TESTFAIL: no addition trail on an open record'; end if;
end; $$;
do $$ begin raise notice 'PASS  1 an open record drops a photograph freely; the removal still names the file'; end $$;

-- Signed with a.jpg; then b, c, d added after sign-off.
update public.qa_records set signoffs = '[{"party":"KBS","signer_name":"M","signature_path":"bbbbbbbb-eeee-0000-0000-000000000001/qa/dddddddd-eeee-0000-0000-000000000001/sig.png","signed_at":"2026-11-11T01:00:00Z"}]'
  where id = 'dddddddd-eeee-0000-0000-000000000001';
update public.qa_records set photo_paths = photo_paths || '{bbbbbbbb-eeee-0000-0000-000000000001/qa/dddddddd-eeee-0000-0000-000000000001/b.jpg,bbbbbbbb-eeee-0000-0000-000000000001/qa/dddddddd-eeee-0000-0000-000000000001/c.jpg,bbbbbbbb-eeee-0000-0000-000000000001/qa/dddddddd-eeee-0000-0000-000000000001/d.jpg}'
  where id = 'dddddddd-eeee-0000-0000-000000000001';
do $$ begin
  if (select completed_at from public.qa_records where id = 'dddddddd-eeee-0000-0000-000000000001') is null then raise exception 'TESTFAIL: should be complete'; end if;
  if app.qa_record_signed_with('dddddddd-eeee-0000-0000-000000000001', (select photo_paths from public.qa_records where id = 'dddddddd-eeee-0000-0000-000000000001'))
     <> '{bbbbbbbb-eeee-0000-0000-000000000001/qa/dddddddd-eeee-0000-0000-000000000001/a.jpg}' then raise exception 'TESTFAIL: signed with a.jpg alone'; end if;
end; $$;

-- 2. The signed-with photograph never comes off, never moves.
select tests.expect_error($$ update public.qa_records set photo_paths = '{bbbbbbbb-eeee-0000-0000-000000000001/qa/dddddddd-eeee-0000-0000-000000000001/b.jpg,bbbbbbbb-eeee-0000-0000-000000000001/qa/dddddddd-eeee-0000-0000-000000000001/c.jpg,bbbbbbbb-eeee-0000-0000-000000000001/qa/dddddddd-eeee-0000-0000-000000000001/d.jpg}' where id = 'dddddddd-eeee-0000-0000-000000000001' $$, 'never removed');
select tests.expect_error($$ update public.qa_records set photo_paths = '{}' where id = 'dddddddd-eeee-0000-0000-000000000001' $$, 'never removed');
select tests.expect_error($$ update public.qa_records set photo_paths = '{bbbbbbbb-eeee-0000-0000-000000000001/qa/dddddddd-eeee-0000-0000-000000000001/b.jpg,bbbbbbbb-eeee-0000-0000-000000000001/qa/dddddddd-eeee-0000-0000-000000000001/a.jpg,bbbbbbbb-eeee-0000-0000-000000000001/qa/dddddddd-eeee-0000-0000-000000000001/c.jpg,bbbbbbbb-eeee-0000-0000-000000000001/qa/dddddddd-eeee-0000-0000-000000000001/d.jpg}' where id = 'dddddddd-eeee-0000-0000-000000000001' $$, 'never removed');
do $$ begin raise notice 'PASS  2 the signed-with photograph never comes off or moves'; end $$;

-- 3. The added ones keep their order; new ones go on the end.
select tests.expect_error($$ update public.qa_records set photo_paths = '{bbbbbbbb-eeee-0000-0000-000000000001/qa/dddddddd-eeee-0000-0000-000000000001/a.jpg,bbbbbbbb-eeee-0000-0000-000000000001/qa/dddddddd-eeee-0000-0000-000000000001/c.jpg,bbbbbbbb-eeee-0000-0000-000000000001/qa/dddddddd-eeee-0000-0000-000000000001/b.jpg,bbbbbbbb-eeee-0000-0000-000000000001/qa/dddddddd-eeee-0000-0000-000000000001/d.jpg}' where id = 'dddddddd-eeee-0000-0000-000000000001' $$, 'keep their order');
select tests.expect_error($$ update public.qa_records set photo_paths = '{bbbbbbbb-eeee-0000-0000-000000000001/qa/dddddddd-eeee-0000-0000-000000000001/a.jpg,bbbbbbbb-eeee-0000-0000-000000000001/qa/dddddddd-eeee-0000-0000-000000000001/e.jpg,bbbbbbbb-eeee-0000-0000-000000000001/qa/dddddddd-eeee-0000-0000-000000000001/b.jpg,bbbbbbbb-eeee-0000-0000-000000000001/qa/dddddddd-eeee-0000-0000-000000000001/c.jpg,bbbbbbbb-eeee-0000-0000-000000000001/qa/dddddddd-eeee-0000-0000-000000000001/d.jpg}' where id = 'dddddddd-eeee-0000-0000-000000000001' $$, 'after the ones already there');
do $$ begin raise notice 'PASS  3 added photographs keep their order and new ones go on the end'; end $$;

-- 4. One added after sign-off comes off; the trail says which, who, when; the record is as signed.
update public.qa_records set photo_paths = '{bbbbbbbb-eeee-0000-0000-000000000001/qa/dddddddd-eeee-0000-0000-000000000001/a.jpg,bbbbbbbb-eeee-0000-0000-000000000001/qa/dddddddd-eeee-0000-0000-000000000001/b.jpg,bbbbbbbb-eeee-0000-0000-000000000001/qa/dddddddd-eeee-0000-0000-000000000001/d.jpg}'
  where id = 'dddddddd-eeee-0000-0000-000000000001';
do $$
declare r record; x record;
begin
  select * into r from public.qa_records where id = 'dddddddd-eeee-0000-0000-000000000001';
  if array_length(r.photo_paths, 1) <> 3 or r.completed_at is null or jsonb_array_length(r.signoffs) <> 1 then raise exception 'TESTFAIL: three photographs on a record still signed'; end if;
  -- One transaction: completed_at is now() (its start), the trail clock_timestamp() — so the newest row, not a time cut.
  select * into x from public.qa_record_photo_removals where record_id = r.id order by at desc limit 1;
  if x.paths <> '{bbbbbbbb-eeee-0000-0000-000000000001/qa/dddddddd-eeee-0000-0000-000000000001/c.jpg}' or x.by_user_id <> '11111111-eeee-0000-0000-000000000001' then
    raise exception 'TESTFAIL: the removal names c.jpg and who took it off: %', row_to_json(x)::text;
  end if;
  if (select count(*) from public.qa_record_photo_additions where record_id = r.id) <> 1 then raise exception 'TESTFAIL: a removal writes no addition'; end if;
end; $$;
-- A removal and an addition in one write: both kept, the signed-with still first.
update public.qa_records set photo_paths = '{bbbbbbbb-eeee-0000-0000-000000000001/qa/dddddddd-eeee-0000-0000-000000000001/a.jpg,bbbbbbbb-eeee-0000-0000-000000000001/qa/dddddddd-eeee-0000-0000-000000000001/d.jpg,bbbbbbbb-eeee-0000-0000-000000000001/qa/dddddddd-eeee-0000-0000-000000000001/e.jpg}'
  where id = 'dddddddd-eeee-0000-0000-000000000001';
do $$ begin
  if (select count(*) from public.qa_record_photo_removals where record_id = 'dddddddd-eeee-0000-0000-000000000001') <> 3 then raise exception 'TESTFAIL: third removal (b.jpg) kept beside x.jpg and c.jpg'; end if;
  if (select paths from public.qa_record_photo_additions where record_id = 'dddddddd-eeee-0000-0000-000000000001' order by at desc limit 1)
     <> '{bbbbbbbb-eeee-0000-0000-000000000001/qa/dddddddd-eeee-0000-0000-000000000001/e.jpg}' then raise exception 'TESTFAIL: the addition of e.jpg kept'; end if;
end; $$;
-- Nothing else rides along; the rest stays frozen.
select tests.expect_error($$ update public.qa_records set photo_paths = '{bbbbbbbb-eeee-0000-0000-000000000001/qa/dddddddd-eeee-0000-0000-000000000001/a.jpg}', comments = 'Changed' where id = 'dddddddd-eeee-0000-0000-000000000001' $$, 'nothing else changes');
select tests.expect_error($$ update public.qa_records set comments = 'After' where id = 'dddddddd-eeee-0000-0000-000000000001' $$, 'frozen');
do $$ begin raise notice 'PASS  4 an added photograph comes off with its trail; the record stays as signed'; end $$;

-- 5. Not on a voided record; the trail is never changed or removed.
update public.qa_records set voided_at = now(), void_reason = 'Wrong lot' where id = 'dddddddd-eeee-0000-0000-000000000001';
select tests.expect_error($$ update public.qa_records set photo_paths = '{bbbbbbbb-eeee-0000-0000-000000000001/qa/dddddddd-eeee-0000-0000-000000000001/a.jpg}' where id = 'dddddddd-eeee-0000-0000-000000000001' $$, 'voided');
reset role;
select tests.expect_error($$ delete from public.qa_record_photo_removals where record_id = 'dddddddd-eeee-0000-0000-000000000001' $$, 'never changed or removed');
select tests.expect_error($$ update public.qa_record_photo_removals set paths = '{x}' where record_id = 'dddddddd-eeee-0000-0000-000000000001' $$, 'never changed or removed');
do $$ begin raise notice 'PASS  5 not on a voided record; the trail is frozen'; end $$;

rollback;
