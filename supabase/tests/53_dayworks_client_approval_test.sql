-- The client approves dayworks by signing on the screen (README R125): the signature is filed under its own job and
-- sign-off, carries the words it was given under and the lines it was given for, is dated by the database, cannot be
-- for nothing or for work not yet done, and is frozen. A paper sign-off still records as before, with or without lines.
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
  ('11111111-5353-0000-0000-000000000001', 'sup.appr@example.com'),
  ('11111111-5353-0000-0000-000000000002', 'lab.appr@example.com'),
  ('11111111-5353-0000-0000-000000000003', 'lh.appr@example.com');
insert into public.organisations (id, name, code) values ('aaaaaaaa-5353-0000-0000-000000000001', 'Approval Civil', 'APC');
insert into public.projects (id, org_id, name, code) values ('bbbbbbbb-5353-0000-0000-000000000001', 'aaaaaaaa-5353-0000-0000-000000000001', 'Approval Job', 'A531');
insert into public.project_members (project_id, user_id, role) values
  ('bbbbbbbb-5353-0000-0000-000000000001', '11111111-5353-0000-0000-000000000001', 'supervisor'),
  ('bbbbbbbb-5353-0000-0000-000000000001', '11111111-5353-0000-0000-000000000002', 'labourer'),
  ('bbbbbbbb-5353-0000-0000-000000000001', '11111111-5353-0000-0000-000000000003', 'leading_hand');
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-5353-0000-0000-000000000001","role":"authenticated"}';

-- Signed on the screen: two lines, the words, the signature in its own folder.
insert into public.dayworks_signoffs (id, project_id, period_label, items, hours, signed_by_name, signed_by_position, signed_on,
                                      signature_path, declaration, signed_on_device_at, lines)
values ('cccccccc-5353-0000-0000-000000000001', 'bbbbbbbb-5353-0000-0000-000000000001', 'Whole job', 2, 14.5, ' dave  keane ', 'Site Manager',
        '2020-01-01',
        'bbbbbbbb-5353-0000-0000-000000000001/cccccccc-5353-0000-0000-000000000001.png',
        'Signing acknowledges the labour, plant and materials expended.', now() - interval '2 hours',
        jsonb_build_array(
          jsonb_build_object('date', (app.perth_today() - 3)::text, 'works', 'Expose the main line', 'hours', 8),
          jsonb_build_object('date', (app.perth_today() - 1)::text, 'works', 'Lay footpath', 'hours', 6.5)));
do $$
declare r public.dayworks_signoffs;
begin
  select * into r from public.dayworks_signoffs where id = 'cccccccc-5353-0000-0000-000000000001';
  if r.signed_how <> 'on_screen' then raise exception 'TESTFAIL: should be marked signed on screen'; end if;
  -- The day is the database's (from the device clock two hours ago), never the 2020 the caller sent.
  if r.signed_on <> ((now() - interval '2 hours') at time zone 'Australia/Perth')::date then raise exception 'TESTFAIL: signed_on not stamped, got %', r.signed_on; end if;
  if r.signed_at is null then raise exception 'TESTFAIL: signed_at not stamped'; end if;
  if r.signed_by_name <> 'dave keane' then raise exception 'TESTFAIL: name not tidied'; end if;
  if r.recorded_by <> '11111111-5353-0000-0000-000000000001' then raise exception 'TESTFAIL: recorded_by not stamped'; end if;
  if jsonb_array_length(r.lines) <> 2 then raise exception 'TESTFAIL: lines not kept'; end if;
end; $$;

-- A device clock that cannot be believed is not: the day falls back to ours.
insert into public.dayworks_signoffs (id, project_id, period_label, items, hours, signed_by_name, signed_on, signature_path, declaration, signed_on_device_at, lines)
values ('cccccccc-5353-0000-0000-000000000002', 'bbbbbbbb-5353-0000-0000-000000000001', 'Whole job', 1, 2, 'Dave Keane', app.perth_today(),
        'bbbbbbbb-5353-0000-0000-000000000001/cccccccc-5353-0000-0000-000000000002.png', 'Signing acknowledges.', now() + interval '3 days',
        jsonb_build_array(jsonb_build_object('date', (app.perth_today() - 2)::text, 'works', 'Water the plants', 'hours', 2)));
do $$ begin
  if (select signed_on from public.dayworks_signoffs where id = 'cccccccc-5353-0000-0000-000000000002') <> app.perth_today() then
    raise exception 'TESTFAIL: a device clock in the future should not date the signature';
  end if;
end; $$;

-- Not under another sign-off's name or another job's folder; not without the words; not for nothing; not for tomorrow's work.
select tests.expect_error($$
  insert into public.dayworks_signoffs (id, project_id, period_label, items, hours, signed_by_name, signed_on, signature_path, declaration, lines)
  values ('cccccccc-5353-0000-0000-000000000003', 'bbbbbbbb-5353-0000-0000-000000000001', 'Whole job', 1, 2, 'Dave', app.perth_today(),
          'bbbbbbbb-5353-0000-0000-000000000001/cccccccc-5353-0000-0000-000000000001.png', 'Words.',
          jsonb_build_array(jsonb_build_object('date', (app.perth_today() - 2)::text, 'works', 'Water', 'hours', 2)))
$$, 'under its own job and sign-off');
select tests.expect_error($$
  insert into public.dayworks_signoffs (id, project_id, period_label, items, hours, signed_by_name, signed_on, signature_path, declaration, lines)
  values ('cccccccc-5353-0000-0000-000000000003', 'bbbbbbbb-5353-0000-0000-000000000001', 'Whole job', 1, 2, 'Dave', app.perth_today(),
          'bbbbbbbb-5353-0000-0000-000000000001/cccccccc-5353-0000-0000-000000000003.png', '   ',
          jsonb_build_array(jsonb_build_object('date', (app.perth_today() - 2)::text, 'works', 'Water', 'hours', 2)))
$$, 'the words it was given under');
select tests.expect_error($$
  insert into public.dayworks_signoffs (id, project_id, period_label, items, hours, signed_by_name, signed_on, signature_path, declaration, lines)
  values ('cccccccc-5353-0000-0000-000000000003', 'bbbbbbbb-5353-0000-0000-000000000001', 'Whole job', 0, 0, 'Dave', app.perth_today(),
          'bbbbbbbb-5353-0000-0000-000000000001/cccccccc-5353-0000-0000-000000000003.png', 'Words.', '[]'::jsonb)
$$, 'nothing here to approve');
select tests.expect_error($$
  insert into public.dayworks_signoffs (id, project_id, period_label, items, hours, signed_by_name, signed_on, signature_path, declaration)
  values ('cccccccc-5353-0000-0000-000000000003', 'bbbbbbbb-5353-0000-0000-000000000001', 'Whole job', 1, 2, 'Dave', app.perth_today(),
          'bbbbbbbb-5353-0000-0000-000000000001/cccccccc-5353-0000-0000-000000000003.png', 'Words.')
$$, 'nothing here to approve');
select tests.expect_error($$
  insert into public.dayworks_signoffs (id, project_id, period_label, items, hours, signed_by_name, signed_on, signature_path, declaration, lines)
  values ('cccccccc-5353-0000-0000-000000000003', 'bbbbbbbb-5353-0000-0000-000000000001', 'Whole job', 1, 2, 'Dave', app.perth_today(),
          'bbbbbbbb-5353-0000-0000-000000000001/cccccccc-5353-0000-0000-000000000003.png', 'Words.',
          jsonb_build_array(jsonb_build_object('date', (app.perth_today() + 1)::text, 'works', 'Tomorrow''s work', 'hours', 2)))
$$, 'before the work it covers was done');
select tests.expect_error($$
  insert into public.dayworks_signoffs (id, project_id, period_label, items, hours, signed_by_name, signed_on, signature_path, declaration, lines)
  values ('cccccccc-5353-0000-0000-000000000003', 'bbbbbbbb-5353-0000-0000-000000000001', 'Whole job', 2, 2, 'Dave', app.perth_today(),
          'bbbbbbbb-5353-0000-0000-000000000001/cccccccc-5353-0000-0000-000000000003.png', 'Words.',
          jsonb_build_array(jsonb_build_object('date', (app.perth_today() - 2)::text, 'works', 'Water', 'hours', 2)))
$$, 'do not add up');
select tests.expect_error($$
  insert into public.dayworks_signoffs (id, project_id, period_label, items, hours, signed_by_name, signed_on, signature_path, declaration, lines)
  values ('cccccccc-5353-0000-0000-000000000003', 'bbbbbbbb-5353-0000-0000-000000000001', 'Whole job', 1, 2, 'Dave', app.perth_today(),
          'bbbbbbbb-5353-0000-0000-000000000001/cccccccc-5353-0000-0000-000000000003.png', 'Words.',
          jsonb_build_array(jsonb_build_object('date', 'yesterday', 'works', 'Water', 'hours', 2)))
$$, 'its date and its works');

-- A sheet signed on paper records as it always did — this week's sheet, signed today, though the week has days left —
-- and keeps the lines it carried.
insert into public.dayworks_signoffs (id, project_id, period_from, period_to, period_label, items, hours, signed_by_name, signed_on, lines)
values ('cccccccc-5353-0000-0000-000000000004', 'bbbbbbbb-5353-0000-0000-000000000001', app.perth_today() - 2, app.perth_today() + 4, 'This week', 1, 3, 'Dave Keane', app.perth_today(),
        jsonb_build_array(jsonb_build_object('date', (app.perth_today() - 1)::text, 'works', 'Mulch', 'hours', 3)));
do $$ begin
  if (select signed_how from public.dayworks_signoffs where id = 'cccccccc-5353-0000-0000-000000000004') <> 'paper' then raise exception 'TESTFAIL: should be paper'; end if;
end; $$;
-- Without lines the old rule still holds.
select tests.expect_error($$
  insert into public.dayworks_signoffs (project_id, period_from, period_to, period_label, items, hours, signed_by_name, signed_on)
  values ('bbbbbbbb-5353-0000-0000-000000000001', app.perth_today() - 30, app.perth_today() - 1, 'A month', 1, 1, 'Someone', app.perth_today() - 5)
$$, 'before the work it covers was done');

-- Frozen, as every signature is.
do $$
declare n integer;
begin
  update public.dayworks_signoffs set hours = 99 where id = 'cccccccc-5353-0000-0000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'TESTFAIL: a sign-off was changed'; end if;
  delete from public.dayworks_signoffs where id = 'cccccccc-5353-0000-0000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'TESTFAIL: a sign-off was removed'; end if;
end; $$;

-- A leading hand reads the approvals and cannot give one; a labourer reads none.
set local request.jwt.claims = '{"sub":"11111111-5353-0000-0000-000000000003","role":"authenticated"}';
do $$ begin if (select count(*) from public.dayworks_signoffs) <> 3 then raise exception 'TESTFAIL: a leading hand should read the approvals'; end if; end; $$;
select tests.expect_error($$
  insert into public.dayworks_signoffs (project_id, period_label, items, hours, signed_by_name, signed_on)
  values ('bbbbbbbb-5353-0000-0000-000000000001', 'Whole job', 1, 1, 'Someone', app.perth_today())
$$, 'row-level security');
set local request.jwt.claims = '{"sub":"11111111-5353-0000-0000-000000000002","role":"authenticated"}';
do $$ begin if (select count(*) from public.dayworks_signoffs) <> 0 then raise exception 'TESTFAIL: a labourer reads the approvals'; end if; end; $$;

reset role;
select tests.expect_error($$ update public.dayworks_signoffs set hours = 99 where id = 'cccccccc-5353-0000-0000-000000000001' $$, 'never changed or removed');
rollback;
