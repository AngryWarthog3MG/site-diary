-- Hazards and incidents: numbered by the database, frozen as the first
-- account, actions gate the close, updates are append-only.
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
  ('11111111-1111-1111-1111-111111111111', 'sup@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'lh@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'pm@example.com');
insert into public.profiles (id, email, full_name) values
  ('11111111-1111-1111-1111-111111111111', 'sup@example.com', 'Sup'),
  ('22222222-2222-2222-2222-222222222222', 'lh@example.com', 'LH'),
  ('33333333-3333-3333-3333-333333333333', 'pm@example.com', 'PM')
on conflict (id) do nothing;
insert into public.organisations (id, name, code) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Kingsbridge Civil', 'KBS');
insert into public.projects (id, org_id, name, code) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Northern', 'C001');
insert into public.project_members (project_id, user_id, role) values
  ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'supervisor'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'leading_hand'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'pm');

-- The leading hand reports a near miss; the database numbers it and freezes it.
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
set local role authenticated;
insert into public.incidents (id, project_id, kind, occurred_at, description, reported_by, status, closed_at, seq)
values ('dddddddd-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'near_miss', now() - interval '2 hours', '  Excavator bucket swung close to Sam ', '22222222-2222-2222-2222-222222222222', 'closed', now(), 99);
insert into public.incidents (id, project_id, kind, occurred_at, description, reported_by)
values ('dddddddd-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000001', 'hazard', now(), 'Open trench unfenced at ch 120', '22222222-2222-2222-2222-222222222222');
do $$ declare a public.incidents; b public.incidents; begin
  select * into a from public.incidents where id = 'dddddddd-0000-0000-0000-000000000001';
  select * into b from public.incidents where id = 'dddddddd-0000-0000-0000-000000000002';
  assert a.seq = 1 and b.seq = 2, format('numbers not issued in order: %s %s', a.seq, b.seq);
  assert a.status = 'open' and a.closed_at is null, 'a report was born closed';
  assert a.description = 'Excavator bucket swung close to Sam', 'the description was not trimmed';
  raise notice 'PASS  reports are numbered by the database and born open';
end $$;
-- The leading hand is not offered the row to edit (zero rows); the trigger refuses anyone who is.
update public.incidents set description = 'Something else' where id = 'dddddddd-0000-0000-0000-000000000001';
do $$ begin
  assert (select description from public.incidents where id = 'dddddddd-0000-0000-0000-000000000001') = 'Excavator bucket swung close to Sam', 'a report was edited';
end $$;
reset role;
select tests.expect_error($q$
  update public.incidents set description = 'Something else' where id = 'dddddddd-0000-0000-0000-000000000001'
$q$, 'first account');
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
set local role authenticated;
-- The leading hand adds an update but may not manage the report.
insert into public.incident_updates (incident_id, kind, body, created_by)
values ('dddddddd-0000-0000-0000-000000000001', 'investigation', 'Spotter was not in place', '22222222-2222-2222-2222-222222222222');
update public.incidents set status = 'investigating' where id = 'dddddddd-0000-0000-0000-000000000001';
do $$ begin
  assert (select status from public.incidents where id = 'dddddddd-0000-0000-0000-000000000001') = 'open', 'a leading hand changed the status';
end $$;
select tests.expect_error($q$
  insert into public.incident_actions (incident_id, action, created_by)
  values ('dddddddd-0000-0000-0000-000000000001', 'Brief spotters', '22222222-2222-2222-2222-222222222222')
$q$, 'row-level security');
do $$ begin raise notice 'PASS  the first account is frozen; a leading hand reports and updates, and does not manage'; end $$;

-- The supervisor manages: actions, then close — only once every action is done.
reset role;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;
insert into public.incident_actions (id, incident_id, action, owner_name, due_on, created_by, done_at)
values ('eeeeeeee-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001', 'Brief spotters at prestart', 'Matty', current_date + 2, '11111111-1111-1111-1111-111111111111', now());
do $$ begin
  assert (select done_at from public.incident_actions where id = 'eeeeeeee-0000-0000-0000-000000000001') is null, 'an action was born done';
end $$;
update public.incidents set status = 'investigating' where id = 'dddddddd-0000-0000-0000-000000000001';
select tests.expect_error($q$
  update public.incidents set status = 'closed' where id = 'dddddddd-0000-0000-0000-000000000001'
$q$, 'every corrective action is done');
update public.incident_actions set done_at = timestamptz '2000-01-01', done_note = 'Done at Monday prestart' where id = 'eeeeeeee-0000-0000-0000-000000000001';
do $$ declare a public.incident_actions; begin
  select * into a from public.incident_actions where id = 'eeeeeeee-0000-0000-0000-000000000001';
  assert a.done_at >= now() - interval '1 minute' and a.done_by = '11111111-1111-1111-1111-111111111111', 'done was not stamped by the database';
end $$;
select tests.expect_error($q$
  update public.incident_actions set action = 'changed' where id = 'eeeeeeee-0000-0000-0000-000000000001'
$q$, 'done action is frozen');
update public.incidents set status = 'closed' where id = 'dddddddd-0000-0000-0000-000000000001';
do $$ declare i public.incidents; begin
  select * into i from public.incidents where id = 'dddddddd-0000-0000-0000-000000000001';
  assert i.status = 'closed' and i.closed_at is not null and i.closed_by = '11111111-1111-1111-1111-111111111111', 'close was not stamped';
  raise notice 'PASS  actions gate the close; done and closed are stamped by the database';
end $$;
-- A done action is part of the record: nobody removes it.
reset role;
select tests.expect_error($q$
  delete from public.incident_actions where id = 'eeeeeeee-0000-0000-0000-000000000001'
$q$, 'part of the record');
-- The phone cannot claim the office was emailed.
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;
select tests.expect_error($q$
  update public.incidents set notified_at = now() where id = 'dddddddd-0000-0000-0000-000000000002'
$q$, 'recorded by the server');
-- A report from the future is refused, not re-dated.
select tests.expect_error($q$
  insert into public.incidents (project_id, kind, occurred_at, description, reported_by)
  values ('bbbbbbbb-0000-0000-0000-000000000001', 'hazard', now() + interval '2 days', 'Tomorrow', '11111111-1111-1111-1111-111111111111')
$q$, 'in the future');
do $$ begin raise notice 'PASS  done actions stay, the phone cannot mark the office emailed, the future is refused'; end $$;

-- Closed: frozen, takes no more.
select tests.expect_error($q$
  update public.incidents set status = 'open' where id = 'dddddddd-0000-0000-0000-000000000001'
$q$, 'closed report is frozen');
select tests.expect_error($q$
  insert into public.incident_updates (incident_id, body, created_by) values ('dddddddd-0000-0000-0000-000000000001', 'late note', '11111111-1111-1111-1111-111111111111')
$q$, 'no more updates');
-- Updates are append-only for everyone.
reset role;
select tests.expect_error($q$
  delete from public.incident_updates where incident_id = 'dddddddd-0000-0000-0000-000000000001'
$q$, 'never changed or removed');
do $$ begin raise notice 'PASS  closed is frozen; updates are append-only'; end $$;

-- The PM reads everything and writes nothing.
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  assert (select count(*) from public.incidents) = 2, 'the PM cannot read the register';
  assert (select count(*) from public.incident_actions) = 1, 'the PM cannot read actions';
end $$;
select tests.expect_error($q$
  insert into public.incidents (project_id, kind, occurred_at, description, reported_by)
  values ('bbbbbbbb-0000-0000-0000-000000000001', 'hazard', now(), 'PM report', '33333333-3333-3333-3333-333333333333')
$q$, 'row-level security');
do $$ begin raise notice 'PASS  the PM reads and cannot write'; end $$;
reset role;
select set_config('request.jwt.claims', '', true);

do $$ begin raise notice 'ALL INCIDENT TESTS PASSED'; end $$;
rollback;
