-- A voided QA record is restored by the office, with a reason, exactly as it stood; the void and the restore are
-- kept on an append-only trail (README R175).
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
  ('11111111-cccc-0000-0000-000000000001', 'pm.restore@example.com'),
  ('11111111-cccc-0000-0000-000000000002', 'super.restore@example.com');
insert into public.organisations (id, name, code) values ('aaaaaaaa-cccc-0000-0000-000000000001', 'Restore Civil', 'RSC');
insert into public.projects (id, org_id, name, code) values ('bbbbbbbb-cccc-0000-0000-000000000001', 'aaaaaaaa-cccc-0000-0000-000000000001', 'Restore Job', 'R201');
insert into public.project_members (project_id, user_id, role) values
  ('bbbbbbbb-cccc-0000-0000-000000000001', '11111111-cccc-0000-0000-000000000001', 'pm'),
  ('bbbbbbbb-cccc-0000-0000-000000000001', '11111111-cccc-0000-0000-000000000002', 'supervisor');
insert into public.qa_templates (id, org_id, spec, issued_at) values
  ('cccccccc-cccc-0000-0000-000000000001', 'aaaaaaaa-cccc-0000-0000-000000000001',
   '{"code":"KBS-QA-R-001","kind":"itr_checklist","title":"Restore form","revision":"A","sections":[{"title":"A","items":[{"id":"1","text":"x"},{"id":"2","text":"y"}]}],"signoffs":[{"party":"KBS","required":true,"kind":"internal"}]}', now());

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-cccc-0000-0000-000000000001","role":"authenticated"}';

-- A record signed by its one party: complete, frozen.
insert into public.qa_records (id, project_id, template_id, items, lot_or_element, comments, signoffs) values
  ('dddddddd-cccc-0000-0000-000000000001', 'bbbbbbbb-cccc-0000-0000-000000000001', 'cccccccc-cccc-0000-0000-000000000001',
   '[{"item_id":"1","state":"ok"},{"item_id":"2","state":"na"}]', 'Building 2', 'As poured',
   '[{"party":"KBS","signer_name":"M","signature_path":"bbbbbbbb-cccc-0000-0000-000000000001/qa/dddddddd-cccc-0000-0000-000000000001/sig.png","signed_at":"2026-10-23T01:00:00Z"}]');
do $$
begin
  if (select completed_at from public.qa_records where id = 'dddddddd-cccc-0000-0000-000000000001') is null then raise exception 'TESTFAIL: should be complete'; end if;
end; $$;

-- 1. Voided with a reason: the trail says who, when and why.
update public.qa_records set voided_at = now(), void_reason = 'Test' where id = 'dddddddd-cccc-0000-0000-000000000001';
do $$
declare e record;
begin
  select * into e from public.qa_record_void_events where record_id = 'dddddddd-cccc-0000-0000-000000000001';
  if e.action <> 'voided' or e.reason <> 'Test' or e.by_user_id <> '11111111-cccc-0000-0000-000000000001' then raise exception 'TESTFAIL: the void should be on the trail'; end if;
end; $$;

-- 2. A plain update does not bring it back, reason or not.
select tests.expect_error($$ update public.qa_records set voided_at = null, void_reason = null where id = 'dddddddd-cccc-0000-0000-000000000001' $$, 'the office restores it');
-- 3. The restore carries its reason.
select tests.expect_error($$ select public.restore_qa_record('dddddddd-cccc-0000-0000-000000000001', '  ') $$, 'carries its reason');
-- 4. The restore does not change the record on the way back.
select set_config('app.qa_restore', 'on', true);
select tests.expect_error($$ update public.qa_records set voided_at = null, comments = 'Changed' where id = 'dddddddd-cccc-0000-0000-000000000001' $$, 'as it stood');
select set_config('app.qa_restore', 'off', true);

-- 5. Not the supervisor.
set local request.jwt.claims = '{"sub":"11111111-cccc-0000-0000-000000000002","role":"authenticated"}';
select tests.expect_error($$ select public.restore_qa_record('dddddddd-cccc-0000-0000-000000000001', 'Voided the wrong one') $$, 'only the office');

-- 6. The office restores it: as it stood, still complete and frozen, the void reason gone, the trail grown by one.
set local request.jwt.claims = '{"sub":"11111111-cccc-0000-0000-000000000001","role":"authenticated"}';
select public.restore_qa_record('dddddddd-cccc-0000-0000-000000000001', 'Voided the wrong one');
do $$
declare r record; n integer; e record;
begin
  select * into r from public.qa_records where id = 'dddddddd-cccc-0000-0000-000000000001';
  if r.voided_at is not null or r.void_reason is not null or r.completed_at is null or r.comments <> 'As poured' or jsonb_array_length(r.signoffs) <> 1 then
    raise exception 'TESTFAIL: the record should be back as it stood'; end if;
  select count(*) into n from public.qa_record_void_events where record_id = r.id;
  if n <> 2 then raise exception 'TESTFAIL: two events expected, got %', n; end if;
  select * into e from public.qa_record_void_events where record_id = r.id order by at desc limit 1;
  if e.action <> 'restored' or e.reason <> 'Voided the wrong one' or e.by_user_id <> '11111111-cccc-0000-0000-000000000001' then raise exception 'TESTFAIL: the restore should be on the trail'; end if;
end; $$;
select tests.expect_error($$ update public.qa_records set comments = 'After' where id = 'dddddddd-cccc-0000-0000-000000000001' $$, 'frozen');
-- 7. A live record is not restored.
select tests.expect_error($$ select public.restore_qa_record('dddddddd-cccc-0000-0000-000000000001', 'Again') $$, 'not voided');

-- 8. The trail is never changed or removed, by anyone.
reset role;
select tests.expect_error($$ delete from public.qa_record_void_events where record_id = 'dddddddd-cccc-0000-0000-000000000001' $$, 'never changed or removed');
select tests.expect_error($$ update public.qa_record_void_events set reason = 'x' where record_id = 'dddddddd-cccc-0000-0000-000000000001' $$, 'never changed or removed');

rollback;
