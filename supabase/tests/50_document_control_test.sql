-- Document control (README R120): a version is born a draft; issuing it assigns the audience with a due date and
-- supersedes the last version's unfinished assignments; a labourer reads the document and their own assignment and
-- signs for themselves by their own name, after passing the comprehension check where there is one; the right
-- answers never leave the database; a supervisor still records a crew signature by hand; waiving needs a reason;
-- events and attempts are frozen; a new member is assigned the current documents; another company sees nothing.
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
  ('11111111-9999-0000-0000-000000000001', 'admin.doc@example.com'),
  ('11111111-9999-0000-0000-000000000002', 'sup.doc@example.com'),
  ('11111111-9999-0000-0000-000000000003', 'lab.doc@example.com'),
  ('11111111-9999-0000-0000-000000000004', 'other.doc@example.com'),
  ('11111111-9999-0000-0000-000000000005', 'late.doc@example.com');
update public.profiles set full_name = 'Ada Admin' where id = '11111111-9999-0000-0000-000000000001';
update public.profiles set full_name = 'Sam Super' where id = '11111111-9999-0000-0000-000000000002';
update public.profiles set full_name = 'Lee Labourer' where id = '11111111-9999-0000-0000-000000000003';
update public.profiles set full_name = 'Olga Other' where id = '11111111-9999-0000-0000-000000000004';
update public.profiles set full_name = 'Lou Late' where id = '11111111-9999-0000-0000-000000000005';
insert into public.organisations (id, name, code) values
  ('aaaaaaaa-9999-0000-0000-000000000001', 'Doc Civil', 'DCC'),
  ('aaaaaaaa-9999-0000-0000-000000000002', 'Other Civil', 'DCO');
insert into public.projects (id, org_id, name, code) values
  ('bbbbbbbb-9999-0000-0000-000000000001', 'aaaaaaaa-9999-0000-0000-000000000001', 'Doc Job', 'X701'),
  ('bbbbbbbb-9999-0000-0000-000000000002', 'aaaaaaaa-9999-0000-0000-000000000002', 'Other Job', 'X702');
insert into public.project_members (project_id, user_id, role) values
  ('bbbbbbbb-9999-0000-0000-000000000001', '11111111-9999-0000-0000-000000000001', 'admin'),
  ('bbbbbbbb-9999-0000-0000-000000000001', '11111111-9999-0000-0000-000000000002', 'supervisor'),
  ('bbbbbbbb-9999-0000-0000-000000000001', '11111111-9999-0000-0000-000000000003', 'labourer'),
  ('bbbbbbbb-9999-0000-0000-000000000002', '11111111-9999-0000-0000-000000000004', 'admin');
set local role authenticated;

-- The admin drafts a policy for everyone, due in 7 days, pass mark 100, with two questions.
set local request.jwt.claims = '{"sub":"11111111-9999-0000-0000-000000000001","role":"authenticated"}';
insert into public.controlled_documents (id, org_id, title, kind, ack_due_days, pass_mark) values
  ('cccccccc-9999-0000-0000-000000000001', 'aaaaaaaa-9999-0000-0000-000000000001', 'Fitness for work policy', 'policy', 7, 100);
select tests.expect_error($$ update public.controlled_documents set audience = '{wizard}' where id = 'cccccccc-9999-0000-0000-000000000001' $$, 'role that does not exist');
insert into public.document_versions (id, document_id, file_path, status) values
  ('dddddddd-9999-0000-0000-000000000001', 'cccccccc-9999-0000-0000-000000000001', 'aaaaaaaa-9999-0000-0000-000000000001/cccccccc-9999-0000-0000-000000000001/dddddddd-9999-0000-0000-000000000001.pdf', 'draft');
do $$ begin
  if (select status from public.document_versions where id = 'dddddddd-9999-0000-0000-000000000001') <> 'draft' then raise exception 'TESTFAIL: not a draft'; end if;
  if (select issued_at from public.document_versions where id = 'dddddddd-9999-0000-0000-000000000001') is not null then raise exception 'TESTFAIL: a draft has no issue date'; end if;
  if (select count(*) from public.document_assignments where version_id = 'dddddddd-9999-0000-0000-000000000001') <> 0 then raise exception 'TESTFAIL: a draft assigns nobody'; end if;
end $$;
insert into public.document_questions (version_id, position, prompt, options, correct_index) values
  ('dddddddd-9999-0000-0000-000000000001', 1, 'When do you tell the supervisor you are unfit?', '{"At knock-off","Before you start work","Never"}', 1),
  ('dddddddd-9999-0000-0000-000000000001', 2, 'Who may operate plant after a positive test?', '{"Nobody","The operator if careful"}', 0);
select tests.expect_error($$ select correct_index from public.document_questions $$, 'permission denied');

-- The labourer cannot see the draft; the admin can.
set local request.jwt.claims = '{"sub":"11111111-9999-0000-0000-000000000003","role":"authenticated"}';
do $$ begin
  if (select count(*) from public.document_versions where id = 'dddddddd-9999-0000-0000-000000000001') <> 0 then raise exception 'TESTFAIL: labourer saw a draft'; end if;
  if (select count(*) from public.controlled_documents where id = 'cccccccc-9999-0000-0000-000000000001') <> 1 then raise exception 'TESTFAIL: labourer cannot read the document'; end if;
end $$;

-- Issued: three people assigned (admin, supervisor, labourer), due in seven days, events written.
set local request.jwt.claims = '{"sub":"11111111-9999-0000-0000-000000000001","role":"authenticated"}';
update public.document_versions set status = 'current' where id = 'dddddddd-9999-0000-0000-000000000001';
do $$ begin
  if (select count(*) from public.document_assignments where version_id = 'dddddddd-9999-0000-0000-000000000001' and status = 'pending') <> 3 then raise exception 'TESTFAIL: expected 3 assignments'; end if;
  if (select due_on from public.document_assignments where version_id = 'dddddddd-9999-0000-0000-000000000001' and user_id = '11111111-9999-0000-0000-000000000003') <> app.perth_today() + 7 then raise exception 'TESTFAIL: due date'; end if;
  if (select issued_at from public.document_versions where id = 'dddddddd-9999-0000-0000-000000000001') is null then raise exception 'TESTFAIL: issued_at not stamped'; end if;
  if (select count(*) from public.document_events where version_id = 'dddddddd-9999-0000-0000-000000000001' and kind in ('drafted', 'issued', 'assigned')) <> 3 then raise exception 'TESTFAIL: events'; end if;
end $$;
select tests.expect_error($$ insert into public.document_questions (version_id, position, prompt, options, correct_index) values ('dddddddd-9999-0000-0000-000000000001', 3, 'Late question', '{"a","b"}', 0) $$, 'frozen');
select tests.expect_error($$ update public.document_versions set status = 'draft' where id = 'dddddddd-9999-0000-0000-000000000001' $$, 'does not go back to draft');

-- The labourer reads the issued version, their own assignment, the questions without the answers; fails, then passes.
set local request.jwt.claims = '{"sub":"11111111-9999-0000-0000-000000000003","role":"authenticated"}';
do $$ declare r jsonb; begin
  if (select count(*) from public.document_versions where id = 'dddddddd-9999-0000-0000-000000000001') <> 1 then raise exception 'TESTFAIL: labourer cannot read the issued version'; end if;
  if (select count(*) from public.document_assignments where version_id = 'dddddddd-9999-0000-0000-000000000001') <> 1 then raise exception 'TESTFAIL: labourer sees other people''s assignments or not their own'; end if;
  if (select count(*) from public.document_questions where version_id = 'dddddddd-9999-0000-0000-000000000001') <> 2 then raise exception 'TESTFAIL: questions unreadable'; end if;
  r := public.answer_document_quiz('dddddddd-9999-0000-0000-000000000001', '{0,0}');
  if (r->>'passed')::boolean then raise exception 'TESTFAIL: a wrong answer passed'; end if;
  r := public.answer_document_quiz('dddddddd-9999-0000-0000-000000000001', '{1,0}');
  if not (r->>'passed')::boolean or (r->>'score')::int <> 2 then raise exception 'TESTFAIL: right answers did not pass: %', r; end if;
end $$;
select tests.expect_error($$ select public.answer_document_quiz('dddddddd-9999-0000-0000-000000000001', '{1}') $$, 'answer every question');
do $$ begin
  if (select count(*) from public.document_answer_key('dddddddd-9999-0000-0000-000000000001')) <> 0 then raise exception 'TESTFAIL: the labourer read the answer key'; end if;
end $$;

-- Signing for themselves: the wrong name is refused; their own name goes through and closes the assignment.
select tests.expect_error($$ insert into public.document_acknowledgements (id, version_id, person_name, signature_path, project_id, recorded_by)
  values ('eeeeeeee-9999-0000-0000-000000000001', 'dddddddd-9999-0000-0000-000000000001', 'Someone Else', 'bbbbbbbb-9999-0000-0000-000000000001/document/eeeeeeee-9999-0000-0000-000000000001/sig.png', 'bbbbbbbb-9999-0000-0000-000000000001', '11111111-9999-0000-0000-000000000003') $$, 'row-level security');
insert into public.document_acknowledgements (id, version_id, person_name, signature_path, project_id, recorded_by, typed_name, time_on_page_s)
  values ('eeeeeeee-9999-0000-0000-000000000002', 'dddddddd-9999-0000-0000-000000000001', 'Lee  Labourer', 'bbbbbbbb-9999-0000-0000-000000000001/document/eeeeeeee-9999-0000-0000-000000000002/sig.png', 'bbbbbbbb-9999-0000-0000-000000000001', '11111111-9999-0000-0000-000000000003', 'Lee Labourer', 95);
do $$ begin
  if (select status from public.document_assignments where version_id = 'dddddddd-9999-0000-0000-000000000001' and user_id = '11111111-9999-0000-0000-000000000003') <> 'signed' then raise exception 'TESTFAIL: assignment not closed by the signature'; end if;
  if (select acknowledgement_id from public.document_assignments where version_id = 'dddddddd-9999-0000-0000-000000000001' and user_id = '11111111-9999-0000-0000-000000000003') <> 'eeeeeeee-9999-0000-0000-000000000002' then raise exception 'TESTFAIL: assignment does not name the acknowledgement'; end if;
  if (select count(*) from public.document_events where subject_id = '11111111-9999-0000-0000-000000000003' and kind = 'signed') <> 1 then raise exception 'TESTFAIL: no signed event'; end if;
end $$;

-- The supervisor has not passed the check: signing for themselves is refused until they do.
set local request.jwt.claims = '{"sub":"11111111-9999-0000-0000-000000000002","role":"authenticated"}';
select tests.expect_error($$ insert into public.document_acknowledgements (id, version_id, person_name, signature_path, project_id, recorded_by)
  values ('eeeeeeee-9999-0000-0000-000000000003', 'dddddddd-9999-0000-0000-000000000001', 'Sam Super', 'bbbbbbbb-9999-0000-0000-000000000001/document/eeeeeeee-9999-0000-0000-000000000003/sig.png', 'bbbbbbbb-9999-0000-0000-000000000001', '11111111-9999-0000-0000-000000000002') $$, 'row-level security');
-- But the supervisor may still record a crew member without an account, by hand, as before (no assignment to close).
insert into public.document_acknowledgements (id, version_id, person_name, signature_path, project_id, recorded_by)
  values ('eeeeeeee-9999-0000-0000-000000000004', 'dddddddd-9999-0000-0000-000000000001', 'Kel Brady', 'bbbbbbbb-9999-0000-0000-000000000001/document/eeeeeeee-9999-0000-0000-000000000004/sig.png', 'bbbbbbbb-9999-0000-0000-000000000001', '11111111-9999-0000-0000-000000000002');
-- The supervisor sees everyone's assignments on the company's record and, keeping the crew, may waive one — with a reason.
do $$ begin
  if (select count(*) from public.document_assignments where version_id = 'dddddddd-9999-0000-0000-000000000001') <> 3 then raise exception 'TESTFAIL: supervisor cannot read the assignments'; end if;
end $$;
select tests.expect_error($$ update public.document_assignments set status = 'waived' where user_id = '11111111-9999-0000-0000-000000000002' and version_id = 'dddddddd-9999-0000-0000-000000000001' $$, 'say why');
update public.document_assignments set status = 'waived', waive_reason = 'Contract ends Friday' where user_id = '11111111-9999-0000-0000-000000000002' and version_id = 'dddddddd-9999-0000-0000-000000000001';
do $$ begin
  if (select waived_by from public.document_assignments where user_id = '11111111-9999-0000-0000-000000000002' and version_id = 'dddddddd-9999-0000-0000-000000000001') <> '11111111-9999-0000-0000-000000000002' then raise exception 'TESTFAIL: waived_by not stamped'; end if;
  if (select count(*) from public.document_events where kind = 'waived') <> 1 then raise exception 'TESTFAIL: no waived event'; end if;
end $$;
set local request.jwt.claims = '{"sub":"11111111-9999-0000-0000-000000000001","role":"authenticated"}';
select tests.expect_error($$ update public.document_assignments set status = 'pending' where user_id = '11111111-9999-0000-0000-000000000003' and version_id = 'dddddddd-9999-0000-0000-000000000001' $$, 'does not change');
-- A labourer's own assignment is theirs to read, not to change: the update touches no row.
set local request.jwt.claims = '{"sub":"11111111-9999-0000-0000-000000000005","role":"authenticated"}';
update public.document_assignments set status = 'waived', waive_reason = 'I would rather not' where user_id = '11111111-9999-0000-0000-000000000005';
set local request.jwt.claims = '{"sub":"11111111-9999-0000-0000-000000000001","role":"authenticated"}';
select tests.expect_error($$ delete from public.document_events where kind = 'waived' $$, '');
do $$ begin
  if (select count(*) from public.document_events where kind = 'waived') <> 1 then raise exception 'TESTFAIL: an event was deleted'; end if;
end $$;

-- The answer key is the manager's.
do $$ begin
  if (select count(*) from public.document_answer_key('dddddddd-9999-0000-0000-000000000001')) <> 2 then raise exception 'TESTFAIL: manager cannot read the key'; end if;
end $$;

-- A new member joins the audience of the current version.
reset role;
insert into public.project_members (project_id, user_id, role) values ('bbbbbbbb-9999-0000-0000-000000000001', '11111111-9999-0000-0000-000000000005', 'labourer');
do $$ begin
  if (select status from public.document_assignments where version_id = 'dddddddd-9999-0000-0000-000000000001' and user_id = '11111111-9999-0000-0000-000000000005') <> 'pending' then raise exception 'TESTFAIL: late member not assigned'; end if;
end $$;
set local role authenticated;

-- A second version, issued straight away: the admin's pending assignment on v1 is superseded; everyone is assigned v2.
set local request.jwt.claims = '{"sub":"11111111-9999-0000-0000-000000000001","role":"authenticated"}';
insert into public.document_versions (id, document_id, file_path) values
  ('dddddddd-9999-0000-0000-000000000002', 'cccccccc-9999-0000-0000-000000000001', 'aaaaaaaa-9999-0000-0000-000000000001/cccccccc-9999-0000-0000-000000000001/dddddddd-9999-0000-0000-000000000002.pdf');
do $$ begin
  if (select status from public.document_versions where id = 'dddddddd-9999-0000-0000-000000000001') <> 'superseded' then raise exception 'TESTFAIL: v1 not superseded'; end if;
  if (select status from public.document_assignments where version_id = 'dddddddd-9999-0000-0000-000000000001' and user_id = '11111111-9999-0000-0000-000000000001') <> 'superseded' then raise exception 'TESTFAIL: pending v1 assignment not superseded'; end if;
  if (select status from public.document_assignments where version_id = 'dddddddd-9999-0000-0000-000000000001' and user_id = '11111111-9999-0000-0000-000000000003') <> 'signed' then raise exception 'TESTFAIL: a signed assignment was touched'; end if;
  if (select count(*) from public.document_assignments where version_id = 'dddddddd-9999-0000-0000-000000000002' and status = 'pending') <> 4 then raise exception 'TESTFAIL: v2 assignments'; end if;
end $$;
-- v2 asks no questions: the labourer signs it without a check.
set local request.jwt.claims = '{"sub":"11111111-9999-0000-0000-000000000003","role":"authenticated"}';
insert into public.document_acknowledgements (id, version_id, person_name, signature_path, project_id, recorded_by)
  values ('eeeeeeee-9999-0000-0000-000000000005', 'dddddddd-9999-0000-0000-000000000002', 'Lee Labourer', 'bbbbbbbb-9999-0000-0000-000000000001/document/eeeeeeee-9999-0000-0000-000000000005/sig.png', 'bbbbbbbb-9999-0000-0000-000000000001', '11111111-9999-0000-0000-000000000003');

-- Another company sees nothing.
set local request.jwt.claims = '{"sub":"11111111-9999-0000-0000-000000000004","role":"authenticated"}';
do $$ begin
  if (select count(*) from public.controlled_documents where org_id = 'aaaaaaaa-9999-0000-0000-000000000001') <> 0 then raise exception 'TESTFAIL: other org reads documents'; end if;
  if (select count(*) from public.document_assignments) <> 0 then raise exception 'TESTFAIL: other org reads assignments'; end if;
  if (select count(*) from public.document_events) <> 0 then raise exception 'TESTFAIL: other org reads events'; end if;
end $$;
select tests.expect_error($$ select public.answer_document_quiz('dddddddd-9999-0000-0000-000000000001', '{1,0}') $$, 'not on your account');

select 'suite 50 ok' as result;
rollback;
