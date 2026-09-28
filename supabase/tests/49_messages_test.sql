-- Messages from the office (README R112): an admin sends to a person on the company's jobs; a supervisor cannot send;
-- the recipient reads theirs and nobody else's; a labourer reads theirs; the text never changes; read and got-it are
-- stamped by the database for the recipient alone; nothing is deleted; another company sees nothing.
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
  ('11111111-8888-0000-0000-000000000001', 'admin.msg@example.com'),
  ('11111111-8888-0000-0000-000000000002', 'sup.msg@example.com'),
  ('11111111-8888-0000-0000-000000000003', 'lab.msg@example.com'),
  ('11111111-8888-0000-0000-000000000004', 'other.msg@example.com');
insert into public.organisations (id, name, code) values
  ('aaaaaaaa-8888-0000-0000-000000000001', 'Message Civil', 'MSC'),
  ('aaaaaaaa-8888-0000-0000-000000000002', 'Other Civil', 'MSO');
insert into public.projects (id, org_id, name, code) values
  ('bbbbbbbb-8888-0000-0000-000000000001', 'aaaaaaaa-8888-0000-0000-000000000001', 'Message Job', 'X601'),
  ('bbbbbbbb-8888-0000-0000-000000000002', 'aaaaaaaa-8888-0000-0000-000000000002', 'Other Job', 'X602');
insert into public.project_members (project_id, user_id, role) values
  ('bbbbbbbb-8888-0000-0000-000000000001', '11111111-8888-0000-0000-000000000001', 'admin'),
  ('bbbbbbbb-8888-0000-0000-000000000001', '11111111-8888-0000-0000-000000000002', 'supervisor'),
  ('bbbbbbbb-8888-0000-0000-000000000001', '11111111-8888-0000-0000-000000000003', 'labourer'),
  ('bbbbbbbb-8888-0000-0000-000000000002', '11111111-8888-0000-0000-000000000004', 'admin');
set local role authenticated;

-- The admin sends to the labourer, on the job.
set local request.jwt.claims = '{"sub":"11111111-8888-0000-0000-000000000001","role":"authenticated"}';
insert into public.messages (id, org_id, project_id, recipient_id, body) values
  ('cccccccc-8888-0000-0000-000000000001', 'aaaaaaaa-8888-0000-0000-000000000001', 'bbbbbbbb-8888-0000-0000-000000000001', '11111111-8888-0000-0000-000000000003', '  Take photos of the trench before backfill. ');
do $$ begin if (select body from public.messages where id = 'cccccccc-8888-0000-0000-000000000001') <> 'Take photos of the trench before backfill.' then raise exception 'TESTFAIL: body not tidied'; end if; end; $$;
-- Not to someone outside the company; not to a job of another company; not to yourself.
select tests.expect_error($$ insert into public.messages (org_id, recipient_id, body) values ('aaaaaaaa-8888-0000-0000-000000000001', '11111111-8888-0000-0000-000000000004', 'hi') $$, 'not on any of this company');
select tests.expect_error($$ insert into public.messages (org_id, project_id, recipient_id, body) values ('aaaaaaaa-8888-0000-0000-000000000001', 'bbbbbbbb-8888-0000-0000-000000000002', '11111111-8888-0000-0000-000000000003', 'hi') $$, 'not this company');
select tests.expect_error($$ insert into public.messages (org_id, recipient_id, body) values ('aaaaaaaa-8888-0000-0000-000000000001', '11111111-8888-0000-0000-000000000001', 'hi') $$, 'not_to_self');
-- The record does not change, and the stamps are not typed.
select tests.expect_error($$ update public.messages set body = 'changed' where id = 'cccccccc-8888-0000-0000-000000000001' $$, 'does not change');
select tests.expect_error($$ update public.messages set read_at = now() where id = 'cccccccc-8888-0000-0000-000000000001' $$, 'own function');
-- No delete policy: a signed-in delete touches nothing. The trigger refuses the service role too (below).
do $$
declare n integer;
begin
  delete from public.messages where id = 'cccccccc-8888-0000-0000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 or not exists (select 1 from public.messages where id = 'cccccccc-8888-0000-0000-000000000001') then raise exception 'TESTFAIL: a message was deleted'; end if;
end; $$;
-- The sender cannot mark it read for them.
select tests.expect_error($$ select public.mark_message_read('cccccccc-8888-0000-0000-000000000001') $$, 'not your message');
-- The push outcome, as the office's server records it.
select public.record_message_push('cccccccc-8888-0000-0000-000000000001', 'no_device', 0);

-- A supervisor cannot send, and reads none of it.
set local request.jwt.claims = '{"sub":"11111111-8888-0000-0000-000000000002","role":"authenticated"}';
select tests.expect_error($$ insert into public.messages (org_id, recipient_id, body) values ('aaaaaaaa-8888-0000-0000-000000000001', '11111111-8888-0000-0000-000000000003', 'hi') $$, 'row-level security');
do $$ begin if (select count(*) from public.messages) <> 0 then raise exception 'TESTFAIL: a supervisor reads others'' messages'; end if; end; $$;

-- The labourer reads theirs, opens it, taps Got it.
set local request.jwt.claims = '{"sub":"11111111-8888-0000-0000-000000000003","role":"authenticated"}';
do $$
declare r record;
begin
  select * into r from public.messages where id = 'cccccccc-8888-0000-0000-000000000001';
  if r is null or r.read_at is not null or r.push_result <> 'no_device' then raise exception 'TESTFAIL: the labourer should read their unread message'; end if;
end; $$;
select public.mark_message_read('cccccccc-8888-0000-0000-000000000001');
select public.acknowledge_message('cccccccc-8888-0000-0000-000000000001');
do $$
declare r record;
begin
  select read_at, acknowledged_at into r from public.messages where id = 'cccccccc-8888-0000-0000-000000000001';
  if r.read_at is null or r.acknowledged_at is null then raise exception 'TESTFAIL: stamps missing'; end if;
end; $$;
select tests.expect_error($$ insert into public.messages (org_id, recipient_id, body) values ('aaaaaaaa-8888-0000-0000-000000000001', '11111111-8888-0000-0000-000000000001', 'hi') $$, 'row-level security');

-- Not even the service role deletes one.
reset role;
select tests.expect_error($$ delete from public.messages where id = 'cccccccc-8888-0000-0000-000000000001' $$, 'never deleted');
set local role authenticated;

-- The other company's admin sees nothing.
set local request.jwt.claims = '{"sub":"11111111-8888-0000-0000-000000000004","role":"authenticated"}';
do $$ begin if (select count(*) from public.messages) <> 0 then raise exception 'TESTFAIL: another company reads messages'; end if; end; $$;
rollback;
