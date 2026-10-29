-- An unsigned record moves to a newer issued revision of the same form; a signed one, another form, or an older
-- revision, never (README R174).
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

insert into auth.users (id, email) values ('11111111-bbbb-0000-0000-000000000001', 'pm.rev@example.com');
insert into public.organisations (id, name, code) values ('aaaaaaaa-bbbb-0000-0000-000000000001', 'Rev Civil', 'RVC');
insert into public.projects (id, org_id, name, code) values ('bbbbbbbb-bbbb-0000-0000-000000000001', 'aaaaaaaa-bbbb-0000-0000-000000000001', 'Rev Job', 'R101');
insert into public.project_members (project_id, user_id, role) values ('bbbbbbbb-bbbb-0000-0000-000000000001', '11111111-bbbb-0000-0000-000000000001', 'pm');

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-bbbb-0000-0000-000000000001","role":"authenticated"}';

-- Rev A issued yesterday, Rev B issued today, and a different form.
insert into public.qa_templates (id, org_id, spec, issued_at) values
  ('cccccccc-bbbb-0000-0000-000000000001', 'aaaaaaaa-bbbb-0000-0000-000000000001',
   '{"code":"KBS-QA-SL-001","kind":"itr_checklist","title":"Soft landscape","revision":"A","hold_point":true,"sections":[{"title":"A","items":[{"id":"1","text":"x"},{"id":"2","text":"y","hold_point":true}]}],"hold_points":[{"id":"HP1","after_item":"2","text":"Hold","parties":["LLB"]}],"signoffs":[{"party":"LLB","required":true,"kind":"external","hold_point":"HP1"},{"party":"KBS","required":true,"kind":"internal"}]}', now() - interval '1 day'),
  ('cccccccc-bbbb-0000-0000-000000000002', 'aaaaaaaa-bbbb-0000-0000-000000000001',
   '{"code":"KBS-QA-SL-001","kind":"itr_checklist","title":"Soft landscape","revision":"B","hold_point":true,"sections":[{"title":"A","items":[{"id":"1","text":"x"},{"id":"2","text":"y","hold_point":true}]}],"hold_points":[{"id":"HP1","after_item":"2","text":"Hold","parties":[]}],"signoffs":[{"party":"Certified by – Kooboolong Services","required":true,"kind":"internal"}]}', now()),
  ('cccccccc-bbbb-0000-0000-000000000003', 'aaaaaaaa-bbbb-0000-0000-000000000001',
   '{"code":"KBS-QA-OTHER","kind":"itr_checklist","title":"Other","revision":"B","sections":[{"title":"A","items":[{"id":"1","text":"x"}]}],"signoffs":[{"party":"KBS","required":true,"kind":"internal"}]}', now());

insert into public.qa_records (id, project_id, template_id, items, lot_or_element) values
  ('dddddddd-bbbb-0000-0000-000000000001', 'bbbbbbbb-bbbb-0000-0000-000000000001', 'cccccccc-bbbb-0000-0000-000000000001', '[{"item_id":"1","state":"ok"},{"item_id":"2","state":"na"}]', 'Old Brand Drive');

-- 1. Not to another form.
select tests.expect_error($$ update public.qa_records set template_id = 'cccccccc-bbbb-0000-0000-000000000003' where id = 'dddddddd-bbbb-0000-0000-000000000001' $$, 'newer issued revision of the same form');
-- 2. Forward to Rev B: the answers travel, the record is still open on its new form; not back again.
update public.qa_records set template_id = 'cccccccc-bbbb-0000-0000-000000000002' where id = 'dddddddd-bbbb-0000-0000-000000000001';
do $$
declare r record;
begin
  select * into r from public.qa_records where id = 'dddddddd-bbbb-0000-0000-000000000001';
  if r.template_id <> 'cccccccc-bbbb-0000-0000-000000000002' or r.completed_at is not null or jsonb_array_length(r.items) <> 2 or r.lot_or_element <> 'Old Brand Drive' then
    raise exception 'TESTFAIL: the record should be on Rev B with its answers'; end if;
end; $$;
select tests.expect_error($$ update public.qa_records set template_id = 'cccccccc-bbbb-0000-0000-000000000001' where id = 'dddddddd-bbbb-0000-0000-000000000001' $$, 'newer issued revision of the same form');
-- 3. Signed on Rev B (its one party), the record is complete and frozen; a Rev C issued after cannot take it.
update public.qa_records set signoffs = '[{"party":"Certified by – Kooboolong Services","signer_name":"M","signature_path":"bbbbbbbb-bbbb-0000-0000-000000000001/qa/dddddddd-bbbb-0000-0000-000000000001/sig.png","signed_at":"2026-10-29T01:00:00Z"}]'
  where id = 'dddddddd-bbbb-0000-0000-000000000001';
insert into public.qa_templates (id, org_id, spec, issued_at) values
  ('cccccccc-bbbb-0000-0000-000000000004', 'aaaaaaaa-bbbb-0000-0000-000000000001',
   '{"code":"KBS-QA-SL-001","kind":"itr_checklist","title":"Soft landscape","revision":"C","sections":[{"title":"A","items":[{"id":"1","text":"x"},{"id":"2","text":"y"}]}],"signoffs":[{"party":"Certified by – Kooboolong Services","required":true,"kind":"internal"}]}', now() + interval '1 minute');
select tests.expect_error($$ update public.qa_records set template_id = 'cccccccc-bbbb-0000-0000-000000000004' where id = 'dddddddd-bbbb-0000-0000-000000000001' $$, 'frozen');
-- 4. One party signed of two, not yet complete: still stays where it was signed.
insert into public.qa_records (id, project_id, template_id, items, signoffs) values
  ('dddddddd-bbbb-0000-0000-000000000002', 'bbbbbbbb-bbbb-0000-0000-000000000001', 'cccccccc-bbbb-0000-0000-000000000001', '[{"item_id":"1","state":"ok"}]',
   '[{"party":"KBS","signer_name":"M","signature_path":"bbbbbbbb-bbbb-0000-0000-000000000001/qa/dddddddd-bbbb-0000-0000-000000000002/sig.png","signed_at":"2026-10-29T01:00:00Z"}]');
select tests.expect_error($$ update public.qa_records set template_id = 'cccccccc-bbbb-0000-0000-000000000002' where id = 'dddddddd-bbbb-0000-0000-000000000002' $$, 'stays on the revision it was signed on');

rollback;
