-- The client's signature on a dayworks sheet: frozen once recorded, never dated ahead of the work or the day,
-- written by whoever keeps the registers, and not readable by a labourer.
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
  ('11111111-2222-0000-0000-000000000001', 'sup.signoff@example.com'),
  ('11111111-2222-0000-0000-000000000002', 'lab.signoff@example.com');
insert into public.organisations (id, name, code) values ('aaaaaaaa-2222-0000-0000-000000000001', 'Signoff Civil', 'SOC');
insert into public.projects (id, org_id, name, code) values ('bbbbbbbb-2222-0000-0000-000000000001', 'aaaaaaaa-2222-0000-0000-000000000001', 'Signoff Job', 'S001');
insert into public.project_members (project_id, user_id, role) values
  ('bbbbbbbb-2222-0000-0000-000000000001', '11111111-2222-0000-0000-000000000001', 'supervisor'),
  ('bbbbbbbb-2222-0000-0000-000000000001', '11111111-2222-0000-0000-000000000002', 'labourer');

-- ---------------------------------------------------------------------------
-- The supervisor keeps the registers, so they record what the client signed.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-2222-0000-0000-000000000001","role":"authenticated"}';

insert into public.dayworks_signoffs (id, project_id, period_from, period_to, period_label, items, hours, signed_by_name, signed_by_position, signed_on)
values ('cccccccc-2222-0000-0000-000000000001', 'bbbbbbbb-2222-0000-0000-000000000001',
        app.perth_today() - 20, app.perth_today() - 10, 'The last ten days but one',
        6, 42.5, '  dave   keane ', ' Site Manager ', app.perth_today() - 9);

do $$
declare r public.dayworks_signoffs;
begin
  select * into r from public.dayworks_signoffs where id = 'cccccccc-2222-0000-0000-000000000001';
  -- The name is tidied, never reshaped.
  if r.signed_by_name <> 'dave keane' then raise exception 'TESTFAIL: name not tidied, got "%"', r.signed_by_name; end if;
  if r.signed_by_position <> 'Site Manager' then raise exception 'TESTFAIL: position not tidied, got "%"', r.signed_by_position; end if;
  -- Who recorded it is stamped by the database, not the caller.
  if r.recorded_by <> '11111111-2222-0000-0000-000000000001' then raise exception 'TESTFAIL: recorded_by not stamped'; end if;
  if r.hours <> 42.5 then raise exception 'TESTFAIL: hours not kept'; end if;
end; $$;

-- A signature cannot be dated ahead of today, nor before the work it covers.
select tests.expect_error($$
  insert into public.dayworks_signoffs (project_id, period_label, items, hours, signed_by_name, signed_on)
  values ('bbbbbbbb-2222-0000-0000-000000000001', 'Tomorrow', 1, 1, 'Someone', app.perth_today() + 1)
$$, 'once it has been signed');

select tests.expect_error($$
  insert into public.dayworks_signoffs (project_id, period_from, period_to, period_label, items, hours, signed_by_name, signed_on)
  values ('bbbbbbbb-2222-0000-0000-000000000001', app.perth_today() - 30, app.perth_today() - 1, 'A month', 1, 1, 'Someone', app.perth_today() - 5)
$$, 'before the work it covers');

-- A period that runs backwards is not a period.
select tests.expect_error($$
  insert into public.dayworks_signoffs (project_id, period_from, period_to, period_label, items, hours, signed_by_name, signed_on)
  values ('bbbbbbbb-2222-0000-0000-000000000001', app.perth_today(), app.perth_today() - 20, 'Backwards', 1, 1, 'Someone', app.perth_today())
$$, 'dayworks_signoffs_period_order');

-- An unnamed signatory is not a signature.
select tests.expect_error($$
  insert into public.dayworks_signoffs (project_id, period_label, items, hours, signed_by_name, signed_on)
  values ('bbbbbbbb-2222-0000-0000-000000000001', 'Whole job', 1, 1, '   ', app.perth_today())
$$, 'dayworks_signoffs_signed_by_name_check');

-- ---------------------------------------------------------------------------
-- Frozen. What the client put their name to does not change afterwards.
-- ---------------------------------------------------------------------------
-- Two guarantees, and both matter. An authenticated caller has no update or
-- delete policy at all, so the statement reaches no row — which succeeds
-- quietly, and is why this counts the rows rather than expecting an error.
do $$
declare n integer;
begin
  update public.dayworks_signoffs set hours = 99 where id = 'cccccccc-2222-0000-0000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'TESTFAIL: an authenticated caller changed % sign-off row(s)', n; end if;
  delete from public.dayworks_signoffs where id = 'cccccccc-2222-0000-0000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'TESTFAIL: an authenticated caller deleted % sign-off row(s)', n; end if;
end; $$;

-- And the service role, which bypasses every policy, is refused by the trigger.
reset role;
select tests.expect_error($$
  update public.dayworks_signoffs set hours = 99 where id = 'cccccccc-2222-0000-0000-000000000001'
$$, 'never changed or removed');
select tests.expect_error($$
  delete from public.dayworks_signoffs where id = 'cccccccc-2222-0000-0000-000000000001'
$$, 'never changed or removed');
set local role authenticated;

-- ---------------------------------------------------------------------------
-- The labourer does not read the claims record.
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"11111111-2222-0000-0000-000000000002","role":"authenticated"}';
do $$
declare n integer;
begin
  select count(*) into n from public.dayworks_signoffs;
  if n <> 0 then raise exception 'TESTFAIL: a labourer read % sign-off row(s)', n; end if;
end; $$;

-- Nor may they record one.
select tests.expect_error($$
  insert into public.dayworks_signoffs (project_id, period_label, items, hours, signed_by_name, signed_on)
  values ('bbbbbbbb-2222-0000-0000-000000000001', 'Whole job', 1, 1, 'Not me', app.perth_today())
$$, 'row-level security');

-- ---------------------------------------------------------------------------
-- And the supervisor still sees it.
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"11111111-2222-0000-0000-000000000001","role":"authenticated"}';
do $$
declare n integer;
begin
  select count(*) into n from public.dayworks_signoffs where id = 'cccccccc-2222-0000-0000-000000000001';
  if n <> 1 then raise exception 'TESTFAIL: the supervisor cannot read what they recorded'; end if;
end; $$;

rollback;
