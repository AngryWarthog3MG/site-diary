-- Site sign-in: the database decides induction and the clocks, a signed-out
-- row is frozen, and only gate duty writes.
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
  ('33333333-3333-3333-3333-333333333333', 'pm@example.com'),
  ('44444444-4444-4444-4444-444444444444', 'outsider@example.com');
insert into public.organisations (id, name, code) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Kingsbridge Civil', 'KBS');
insert into public.projects (id, org_id, name, code) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Northern', 'C001');
insert into public.project_members (project_id, user_id, role) values
  ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'supervisor'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'leading_hand'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'pm');

-- The leading hand is on the gate.
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
set local role authenticated;

insert into public.crew_inductions (project_id, person_name, inducted_by)
values ('bbbbbbbb-0000-0000-0000-000000000001', 'Sam Whitely', '22222222-2222-2222-2222-222222222222');

insert into public.site_signins (id, project_id, signin_date, person_name, person_kind, signed_in_on_device_at, signed_in_by, inducted, signed_out_at)
values ('dddddddd-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', date '2026-09-14', '  Danny Rowe ', 'crew',
        timestamptz '2026-09-14 06:58+08', '22222222-2222-2222-2222-222222222222', true, now());
insert into public.site_signins (id, project_id, signin_date, person_name, person_kind, company, signed_in_on_device_at, signed_in_by)
values ('dddddddd-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000001', date '2026-09-14', 'sam whitely', 'subcontractor', ' Whitely Plumbing ',
        timestamptz '2026-09-14 07:02+08', '22222222-2222-2222-2222-222222222222');

do $$
declare d public.site_signins; s public.site_signins;
begin
  select * into d from public.site_signins where id = 'dddddddd-0000-0000-0000-000000000001';
  select * into s from public.site_signins where id = 'dddddddd-0000-0000-0000-000000000002';
  assert d.person_name = 'Danny Rowe', 'the name was not trimmed';
  assert d.inducted = false, 'the phone said inducted; the database must decide (Danny is not)';
  assert d.signed_out_at is null, 'a sign-in was born signed out';
  assert s.inducted = true, 'Sam is inducted on the job, matched without regard to case';
  assert s.company = 'Whitely Plumbing', 'the company was not trimmed';
  assert d.signed_in_at >= now() - interval '1 minute', 'the arrival is the server clock';
  raise notice 'PASS  the database trims, decides induction and stamps the arrival';
end $$;

-- The same person twice while still on site: refused, not doubled — however the spaces fell.
select tests.expect_error($q$
  insert into public.site_signins (project_id, signin_date, person_name, signed_in_by)
  values ('bbbbbbbb-0000-0000-0000-000000000001', date '2026-09-14', 'DANNY ROWE', '22222222-2222-2222-2222-222222222222')
$q$, 'site_signins_one_open_idx');
select tests.expect_error($q$
  insert into public.site_signins (project_id, signin_date, person_name, signed_in_by)
  values ('bbbbbbbb-0000-0000-0000-000000000001', date '2026-09-14', 'Danny    Rowe', '22222222-2222-2222-2222-222222222222')
$q$, 'site_signins_one_open_idx');

-- A phone clock nowhere near the day is not a fact: the server's time stands in and the row says so.
insert into public.site_signins (id, project_id, signin_date, person_name, signed_in_on_device_at, signed_in_by)
values ('dddddddd-0000-0000-0000-000000000009', 'bbbbbbbb-0000-0000-0000-000000000001', date '2026-09-14', 'Kel  Brady',
        timestamptz '2036-01-01 00:00+08', '22222222-2222-2222-2222-222222222222');
do $$
declare k public.site_signins;
begin
  select * into k from public.site_signins where id = 'dddddddd-0000-0000-0000-000000000009';
  assert k.person_name = 'Kel Brady', 'internal spaces were not collapsed';
  assert k.signed_in_on_device_at >= now() - interval '1 minute', 'a 2036 phone clock was kept as the sign-in time';
  assert k.notes like '%clock out of range%', 'the substituted clock was not noted on the row';
  raise notice 'PASS  names collapse their spaces; a wild phone clock is replaced and noted';
end $$;
delete from public.site_signins where id = 'dddddddd-0000-0000-0000-000000000009';

-- Nothing on an open sign-in changes but the sign-out.
select tests.expect_error($q$
  update public.site_signins set person_name = 'Daniel Rowe' where id = 'dddddddd-0000-0000-0000-000000000001'
$q$, 'only be signed out');

-- Sign out: the phone's time is kept, the arrival is stamped, the signer is recorded.
update public.site_signins
   set signed_out_at = timestamptz '2000-01-01 00:00+00', signed_out_on_device_at = timestamptz '2026-09-14 15:31+08'
 where id = 'dddddddd-0000-0000-0000-000000000001';
do $$
declare d public.site_signins;
begin
  select * into d from public.site_signins where id = 'dddddddd-0000-0000-0000-000000000001';
  assert d.signed_out_at >= now() - interval '1 minute', 'the sign-out arrival is not the server clock';
  assert d.signed_out_on_device_at = timestamptz '2026-09-14 15:31+08', 'the phone''s sign-out time was lost';
  assert d.signed_out_by = '22222222-2222-2222-2222-222222222222', 'the sign-out was not attributed';
  raise notice 'PASS  a sign-out keeps the phone''s time and stamps the arrival';
end $$;

-- Once signed out, frozen: the policy no longer offers the row to an update
-- (zero rows, no error — assert the state), and the trigger refuses anyone the
-- policy does let through.
update public.site_signins set signed_out_at = null where id = 'dddddddd-0000-0000-0000-000000000001';
do $$ begin
  assert (select signed_out_at from public.site_signins where id = 'dddddddd-0000-0000-0000-000000000001') is not null,
         'a signed-out row was reopened';
end $$;
reset role;
select tests.expect_error($q$
  update public.site_signins set signed_out_at = null where id = 'dddddddd-0000-0000-0000-000000000001'
$q$, 'frozen');
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
set local role authenticated;
-- The same name may sign in again (came back after lunch).
insert into public.site_signins (id, project_id, signin_date, person_name, signed_in_by)
values ('dddddddd-0000-0000-0000-000000000003', 'bbbbbbbb-0000-0000-0000-000000000001', date '2026-09-14', 'Danny Rowe', '22222222-2222-2222-2222-222222222222');
do $$ begin raise notice 'PASS  a signed-out row is frozen and the person can sign in again'; end $$;

-- A wrong tap: whoever recorded it removes it while open; a frozen row stays.
delete from public.site_signins where id = 'dddddddd-0000-0000-0000-000000000003';
delete from public.site_signins where id = 'dddddddd-0000-0000-0000-000000000001';
do $$ begin
  assert not exists (select 1 from public.site_signins where id = 'dddddddd-0000-0000-0000-000000000003'), 'an open wrong tap could not be undone';
  assert exists (select 1 from public.site_signins where id = 'dddddddd-0000-0000-0000-000000000001'), 'a signed-out row was deleted';
  raise notice 'PASS  a wrong tap is undone while open; a signed-out row is kept';
end $$;

-- The supervisor cannot undo the leading hand's tap (not theirs), but can sign the person out.
reset role;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;
delete from public.site_signins where id = 'dddddddd-0000-0000-0000-000000000002';
do $$ begin
  assert exists (select 1 from public.site_signins where id = 'dddddddd-0000-0000-0000-000000000002'), 'someone else''s open sign-in was deleted';
end $$;
update public.site_signins set signed_out_at = now() where id = 'dddddddd-0000-0000-0000-000000000002';
do $$ begin
  assert (select signed_out_by from public.site_signins where id = 'dddddddd-0000-0000-0000-000000000002') = '11111111-1111-1111-1111-111111111111',
         'the supervisor''s sign-out was not attributed to them';
  raise notice 'PASS  anyone on gate duty signs out; only the recorder undoes a tap';
end $$;

-- The gate: a self-signed sign-in comes only through the server (no account), and carries no account.
reset role;
select set_config('request.jwt.claims', '', true);
select tests.expect_error($q$
  insert into public.site_signins (project_id, signin_date, person_name, person_kind, self_signed)
  values ('bbbbbbbb-0000-0000-0000-000000000001', date '2026-09-14', 'Unsigned Visitor', 'visitor', true)
$q$, 'signs and accepts');
insert into public.site_signins (id, project_id, signin_date, person_name, person_kind, company, contact, self_signed, rules_acknowledged_at, signature_path)
values ('dddddddd-0000-0000-0000-000000000010', 'bbbbbbbb-0000-0000-0000-000000000001', date '2026-09-14', 'Jo Visitor', 'visitor', 'ACME', '0400 000 000', true, now(),
        'bbbbbbbb-0000-0000-0000-000000000001/signin/dddddddd-0000-0000-0000-000000000010/sig.png');
do $$ begin
  assert (select signed_in_by is null and self_signed from public.site_signins where id = 'dddddddd-0000-0000-0000-000000000010'), 'a gate sign-in was not recorded as self-signed';
end $$;
select tests.expect_error($q$
  insert into public.site_signins (project_id, signin_date, person_name, person_kind)
  values ('bbbbbbbb-0000-0000-0000-000000000001', date '2026-09-14', 'Nobody', 'visitor')
$q$, 'made by someone');
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;
select tests.expect_error($q$
  insert into public.site_signins (project_id, signin_date, person_name, person_kind, self_signed, signed_in_by)
  values ('bbbbbbbb-0000-0000-0000-000000000001', date '2026-09-14', 'Fake Gate', 'visitor', true, '11111111-1111-1111-1111-111111111111')
$q$, 'through the gate');
do $$ begin raise notice 'PASS  gate sign-ins come only through the server and carry no account'; end $$;
reset role;

-- The PM reads the register and writes nothing.
reset role;
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  assert (select count(*) from public.site_signins where project_id = 'bbbbbbbb-0000-0000-0000-000000000001') = 3, 'the PM cannot read the register';
end $$;
select tests.expect_error($q$
  insert into public.site_signins (project_id, signin_date, person_name, signed_in_by)
  values ('bbbbbbbb-0000-0000-0000-000000000001', date '2026-09-14', 'Kel Brady', '33333333-3333-3333-3333-333333333333')
$q$, 'row-level security');
do $$ begin raise notice 'PASS  the PM reads and cannot write'; end $$;

-- An outsider sees nothing.
reset role;
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  assert (select count(*) from public.site_signins) = 0, 'an outsider can see the register';
  raise notice 'PASS  an outsider sees nothing';
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

do $$ begin raise notice 'ALL SITE SIGN-IN TESTS PASSED'; end $$;
rollback;
