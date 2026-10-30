-- Photographs are added to a signed QA record, never removed, nothing else with them; each addition is kept with who
-- and when (README R176).
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

insert into auth.users (id, email) values ('11111111-dddd-0000-0000-000000000001', 'pm.photos@example.com');
insert into public.organisations (id, name, code) values ('aaaaaaaa-dddd-0000-0000-000000000001', 'Photo Civil', 'PHC');
insert into public.projects (id, org_id, name, code) values ('bbbbbbbb-dddd-0000-0000-000000000001', 'aaaaaaaa-dddd-0000-0000-000000000001', 'Photo Job', 'P301');
insert into public.project_members (project_id, user_id, role) values ('bbbbbbbb-dddd-0000-0000-000000000001', '11111111-dddd-0000-0000-000000000001', 'pm');
insert into public.qa_templates (id, org_id, spec, issued_at) values
  ('cccccccc-dddd-0000-0000-000000000001', 'aaaaaaaa-dddd-0000-0000-000000000001',
   '{"code":"KBS-QA-P-001","kind":"itr_checklist","title":"Photo form","revision":"A","sections":[{"title":"A","items":[{"id":"1","text":"x"}]}],"signoffs":[{"party":"KBS","required":true,"kind":"internal"}]}', now());

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-dddd-0000-0000-000000000001","role":"authenticated"}';

-- 1. An open record takes photographs the ordinary way; no addition is written for it.
insert into public.qa_records (id, project_id, template_id, items, lot_or_element, photo_paths) values
  ('dddddddd-dddd-0000-0000-000000000001', 'bbbbbbbb-dddd-0000-0000-000000000001', 'cccccccc-dddd-0000-0000-000000000001',
   '[{"item_id":"1","state":"ok"}]', 'Building 2', '{}');
update public.qa_records set photo_paths = '{bbbbbbbb-dddd-0000-0000-000000000001/qa/dddddddd-dddd-0000-0000-000000000001/a.jpg}' where id = 'dddddddd-dddd-0000-0000-000000000001';
do $$ begin
  if (select count(*) from public.qa_record_photo_additions) <> 0 then raise exception 'TESTFAIL: no addition on an open record'; end if;
end; $$;
-- Signed: complete and frozen, with its one photograph.
update public.qa_records set signoffs = '[{"party":"KBS","signer_name":"M","signature_path":"bbbbbbbb-dddd-0000-0000-000000000001/qa/dddddddd-dddd-0000-0000-000000000001/sig.png","signed_at":"2026-10-23T01:00:00Z"}]'
  where id = 'dddddddd-dddd-0000-0000-000000000001';
do $$ begin
  if (select completed_at from public.qa_records where id = 'dddddddd-dddd-0000-0000-000000000001') is null then raise exception 'TESTFAIL: should be complete'; end if;
end; $$;

-- 2. A photograph added after sign-off: the list grows, the record is as signed, the addition says which, who, when.
update public.qa_records set photo_paths = photo_paths || '{bbbbbbbb-dddd-0000-0000-000000000001/qa/dddddddd-dddd-0000-0000-000000000001/b.jpg,bbbbbbbb-dddd-0000-0000-000000000001/qa/dddddddd-dddd-0000-0000-000000000001/c.jpg}'
  where id = 'dddddddd-dddd-0000-0000-000000000001';
do $$
declare r record; a record;
begin
  select * into r from public.qa_records where id = 'dddddddd-dddd-0000-0000-000000000001';
  if array_length(r.photo_paths, 1) <> 3 or r.completed_at is null or jsonb_array_length(r.signoffs) <> 1 then raise exception 'TESTFAIL: three photographs on a record still signed'; end if;
  select * into a from public.qa_record_photo_additions where record_id = r.id;
  if a.paths <> '{bbbbbbbb-dddd-0000-0000-000000000001/qa/dddddddd-dddd-0000-0000-000000000001/b.jpg,bbbbbbbb-dddd-0000-0000-000000000001/qa/dddddddd-dddd-0000-0000-000000000001/c.jpg}'
     or a.by_user_id <> '11111111-dddd-0000-0000-000000000001' then raise exception 'TESTFAIL: the addition should name the two new photographs and who added them'; end if;
end; $$;
-- 3. Nothing else rides along with a photograph.
select tests.expect_error($$ update public.qa_records set photo_paths = photo_paths || '{bbbbbbbb-dddd-0000-0000-000000000001/qa/dddddddd-dddd-0000-0000-000000000001/d.jpg}', comments = 'Changed' where id = 'dddddddd-dddd-0000-0000-000000000001' $$, 'nothing else changes');
-- 4. Never removed, never reordered.
select tests.expect_error($$ update public.qa_records set photo_paths = '{}' where id = 'dddddddd-dddd-0000-0000-000000000001' $$, 'never removed');
select tests.expect_error($$ update public.qa_records set photo_paths = '{bbbbbbbb-dddd-0000-0000-000000000001/qa/dddddddd-dddd-0000-0000-000000000001/c.jpg,bbbbbbbb-dddd-0000-0000-000000000001/qa/dddddddd-dddd-0000-0000-000000000001/b.jpg,bbbbbbbb-dddd-0000-0000-000000000001/qa/dddddddd-dddd-0000-0000-000000000001/a.jpg,bbbbbbbb-dddd-0000-0000-000000000001/qa/dddddddd-dddd-0000-0000-000000000001/d.jpg}' where id = 'dddddddd-dddd-0000-0000-000000000001' $$, 'never removed');
-- 5. Still in the record's own folder.
select tests.expect_error($$ update public.qa_records set photo_paths = photo_paths || '{bbbbbbbb-dddd-0000-0000-000000000001/qa/other/d.jpg}' where id = 'dddddddd-dddd-0000-0000-000000000001' $$, 'own folder');
-- 6. The rest of the record is as frozen as ever.
select tests.expect_error($$ update public.qa_records set comments = 'After' where id = 'dddddddd-dddd-0000-0000-000000000001' $$, 'frozen');
-- 7. Not on a voided record.
update public.qa_records set voided_at = now(), void_reason = 'Wrong lot' where id = 'dddddddd-dddd-0000-0000-000000000001';
select tests.expect_error($$ update public.qa_records set photo_paths = photo_paths || '{bbbbbbbb-dddd-0000-0000-000000000001/qa/dddddddd-dddd-0000-0000-000000000001/d.jpg}' where id = 'dddddddd-dddd-0000-0000-000000000001' $$, 'voided');
-- 8. The additions are never changed or removed.
reset role;
select tests.expect_error($$ delete from public.qa_record_photo_additions where record_id = 'dddddddd-dddd-0000-0000-000000000001' $$, 'never changed or removed');
select tests.expect_error($$ update public.qa_record_photo_additions set paths = '{x}' where record_id = 'dddddddd-dddd-0000-0000-000000000001' $$, 'never changed or removed');

rollback;
