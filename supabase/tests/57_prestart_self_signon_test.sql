-- Signing on to the prestart from your own phone (README R141): a member of the job puts their own name to the day's
-- open prestart, once; another name, a finished prestart, or a job they are not on is refused by the database; an
-- open prestart is readable by the labourer and a finished one is not; their own sign-on is theirs to read.
begin;
create schema tests;
grant usage on schema tests to public;
create function tests.expect_error(p_sql text, p_fragment text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'TESTFAIL: expected failure but statement succeeded: %', p_sql;
exception when others then
  if sqlerrm like 'TESTFAIL:%' then raise; end if;
  if position(lower(p_fragment) in lower(sqlerrm)) = 0 then
    raise exception 'TESTFAIL: wrong error for [%] — got "%", expected "%"', p_sql, sqlerrm, p_fragment;
  end if;
end; $$;

insert into auth.users (id, email) values
  ('11111111-5757-0000-0000-000000000001', 'sup.ps@example.com'),
  ('11111111-5757-0000-0000-000000000002', 'lab.ps@example.com'),
  ('11111111-5757-0000-0000-000000000003', 'other.ps@example.com');
insert into public.profiles (id, email, full_name) values
  ('11111111-5757-0000-0000-000000000001', 'sup.ps@example.com', 'Sup Ervisor'),
  ('11111111-5757-0000-0000-000000000002', 'lab.ps@example.com', 'Lab Ourer'),
  ('11111111-5757-0000-0000-000000000003', 'other.ps@example.com', 'Other Job')
on conflict (id) do update set full_name = excluded.full_name;
insert into public.organisations (id, name, code) values ('aaaaaaaa-5757-0000-0000-000000000001', 'Signon Civil', 'SOC');
insert into public.projects (id, org_id, name, code) values
  ('bbbbbbbb-5757-0000-0000-000000000001', 'aaaaaaaa-5757-0000-0000-000000000001', 'Signon Job', 'F571'),
  ('bbbbbbbb-5757-0000-0000-000000000002', 'aaaaaaaa-5757-0000-0000-000000000001', 'Other Job', 'F572');
insert into public.project_members (project_id, user_id, role) values
  ('bbbbbbbb-5757-0000-0000-000000000001', '11111111-5757-0000-0000-000000000001', 'supervisor'),
  ('bbbbbbbb-5757-0000-0000-000000000001', '11111111-5757-0000-0000-000000000002', 'labourer'),
  ('bbbbbbbb-5757-0000-0000-000000000002', '11111111-5757-0000-0000-000000000003', 'labourer');
insert into public.prestarts (id, project_id, prestart_date, supervisor_name, work_planned, hazards, conducted_by) values
  ('cccccccc-5757-0000-0000-000000000001', 'bbbbbbbb-5757-0000-0000-000000000001', current_date, 'Sup Ervisor', 'Kerbs', 'Traffic', '11111111-5757-0000-0000-000000000001'),
  ('cccccccc-5757-0000-0000-000000000002', 'bbbbbbbb-5757-0000-0000-000000000001', current_date - 1, 'Sup Ervisor', 'Yesterday', 'None', '11111111-5757-0000-0000-000000000001');
insert into public.prestart_attendees (prestart_id, attendee_name, signature_path) values
  ('cccccccc-5757-0000-0000-000000000002', 'Sup Ervisor', 'bbbbbbbb-5757-0000-0000-000000000001/prestart/cccccccc-5757-0000-0000-000000000002/sig-x.png');
update public.prestarts set completed_at = now() where id = 'cccccccc-5757-0000-0000-000000000002';

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-5757-0000-0000-000000000002","role":"authenticated"}';

-- The labourer reads today's open prestart and not yesterday's finished one.
do $$ begin
  if (select count(*) from public.prestarts where id = 'cccccccc-5757-0000-0000-000000000001') <> 1 then raise exception 'TESTFAIL: the labourer cannot read the open prestart'; end if;
  if (select count(*) from public.prestarts where id = 'cccccccc-5757-0000-0000-000000000002') <> 0 then raise exception 'TESTFAIL: the labourer reads a finished prestart'; end if;
  if (select count(*) from public.prestart_attendees) <> 0 then raise exception 'TESTFAIL: the labourer reads the finished attendance'; end if;
end $$;

-- Another name, a finished prestart: refused.
select tests.expect_error($$ insert into public.prestart_attendees (prestart_id, attendee_name, signature_path)
  values ('cccccccc-5757-0000-0000-000000000001', 'Sup Ervisor', 'bbbbbbbb-5757-0000-0000-000000000001/prestart/cccccccc-5757-0000-0000-000000000001/sig-1.png') $$, 'row-level security');
select tests.expect_error($$ insert into public.prestart_attendees (prestart_id, attendee_name, signature_path)
  values ('cccccccc-5757-0000-0000-000000000002', 'Lab Ourer', 'bbbbbbbb-5757-0000-0000-000000000001/prestart/cccccccc-5757-0000-0000-000000000002/sig-2.png') $$, 'finished');

-- Their own name, on the open one: once.
insert into public.prestart_attendees (prestart_id, attendee_name, fit_for_work, signature_path)
  values ('cccccccc-5757-0000-0000-000000000001', '  lab  ourer ', true, 'bbbbbbbb-5757-0000-0000-000000000001/prestart/cccccccc-5757-0000-0000-000000000001/sig-3.png');
do $$ begin
  if (select count(*) from public.prestart_attendees where prestart_id = 'cccccccc-5757-0000-0000-000000000001') <> 1 then raise exception 'TESTFAIL: the labourer cannot read their own sign-on'; end if;
end $$;
select tests.expect_error($$ insert into public.prestart_attendees (prestart_id, attendee_name, signature_path)
  values ('cccccccc-5757-0000-0000-000000000001', 'Lab Ourer', 'bbbbbbbb-5757-0000-0000-000000000001/prestart/cccccccc-5757-0000-0000-000000000001/sig-4.png') $$, 'row-level security');

-- Someone on another job: reads nothing here, signs nothing here.
set local request.jwt.claims = '{"sub":"11111111-5757-0000-0000-000000000003","role":"authenticated"}';
do $$ begin
  if (select count(*) from public.prestarts) <> 0 then raise exception 'TESTFAIL: a member of another job reads the prestart'; end if;
end $$;
select tests.expect_error($$ insert into public.prestart_attendees (prestart_id, attendee_name, signature_path)
  values ('cccccccc-5757-0000-0000-000000000001', 'Other Job', 'bbbbbbbb-5757-0000-0000-000000000001/prestart/cccccccc-5757-0000-0000-000000000001/sig-5.png') $$, 'row-level security');

-- The supervisor sees the labourer's sign-on and finishes last, as ever.
set local request.jwt.claims = '{"sub":"11111111-5757-0000-0000-000000000001","role":"authenticated"}';
do $$ begin
  if (select count(*) from public.prestart_attendees where prestart_id = 'cccccccc-5757-0000-0000-000000000001') <> 1 then raise exception 'TESTFAIL: the supervisor does not see the self sign-on'; end if;
end $$;
update public.prestarts set completed_at = now() where id = 'cccccccc-5757-0000-0000-000000000001';
set local request.jwt.claims = '{"sub":"11111111-5757-0000-0000-000000000002","role":"authenticated"}';
do $$ begin
  if (select count(*) from public.prestarts) <> 0 then raise exception 'TESTFAIL: a finished prestart stays open to the labourer'; end if;
  raise notice 'PASS  signing on to the prestart as yourself (R141)';
end $$;
rollback;
