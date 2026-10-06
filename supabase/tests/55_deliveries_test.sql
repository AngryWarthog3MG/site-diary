-- Deliveries (README R127): booked, then received (stamped) or cancelled (with a reason) and frozen; every move keeps
-- the earlier date; nothing deleted; the order it points at must be the job's; a leading hand books and receives, a
-- labourer reads none, another job reads none.
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
  ('11111111-5555-0000-0000-000000000001', 'sup.del@example.com'),
  ('11111111-5555-0000-0000-000000000002', 'lh.del@example.com'),
  ('11111111-5555-0000-0000-000000000003', 'lab.del@example.com');
insert into public.organisations (id, name, code) values ('aaaaaaaa-5555-0000-0000-000000000001', 'Delivery Civil', 'DLC');
insert into public.projects (id, org_id, name, code) values
  ('bbbbbbbb-5555-0000-0000-000000000001', 'aaaaaaaa-5555-0000-0000-000000000001', 'Delivery Job', 'E551'),
  ('bbbbbbbb-5555-0000-0000-000000000002', 'aaaaaaaa-5555-0000-0000-000000000001', 'Other Job', 'E552');
insert into public.project_members (project_id, user_id, role) values
  ('bbbbbbbb-5555-0000-0000-000000000001', '11111111-5555-0000-0000-000000000001', 'supervisor'),
  ('bbbbbbbb-5555-0000-0000-000000000001', '11111111-5555-0000-0000-000000000002', 'leading_hand'),
  ('bbbbbbbb-5555-0000-0000-000000000001', '11111111-5555-0000-0000-000000000003', 'labourer'),
  ('bbbbbbbb-5555-0000-0000-000000000002', '11111111-5555-0000-0000-000000000001', 'supervisor');
insert into public.orders (id, project_id, seq, kind, item, raised_by, status) values
  ('dddddddd-5555-0000-0000-000000000001', 'bbbbbbbb-5555-0000-0000-000000000001', 1, 'material', 'Mulch 20 m3', '11111111-5555-0000-0000-000000000001', 'ordered'),
  ('dddddddd-5555-0000-0000-000000000002', 'bbbbbbbb-5555-0000-0000-000000000002', 1, 'material', 'Other job''s order', '11111111-5555-0000-0000-000000000001', 'ordered');
set local role authenticated;

-- The leading hand books a delivery; tidied and stamped.
set local request.jwt.claims = '{"sub":"11111111-5555-0000-0000-000000000002","role":"authenticated"}';
insert into public.deliveries (id, project_id, booked_for, item, quantity, supplier, window_text, order_id)
values ('cccccccc-5555-0000-0000-000000000001', 'bbbbbbbb-5555-0000-0000-000000000001', '2026-10-12', '  Plants  for PG1 ', ' 400 ', 'Benara  Nurseries', ' AM ', 'dddddddd-5555-0000-0000-000000000001');
do $$
declare r public.deliveries;
begin
  select * into r from public.deliveries where id = 'cccccccc-5555-0000-0000-000000000001';
  if r.item <> 'Plants for PG1' or r.quantity <> '400' or r.supplier <> 'Benara Nurseries' or r.window_text <> 'AM' then raise exception 'TESTFAIL: not tidied'; end if;
  if r.status <> 'booked' or r.booked_by <> '11111111-5555-0000-0000-000000000002' then raise exception 'TESTFAIL: not stamped'; end if;
end; $$;
-- Not born received; not pointing at another job's order.
select tests.expect_error($$ insert into public.deliveries (project_id, booked_for, item, status) values ('bbbbbbbb-5555-0000-0000-000000000001', '2026-10-12', 'Sand', 'received') $$, 'booked first');
select tests.expect_error($$ insert into public.deliveries (project_id, booked_for, item, order_id) values ('bbbbbbbb-5555-0000-0000-000000000001', '2026-10-12', 'Sand', 'dddddddd-5555-0000-0000-000000000002') $$, 'not on this job');
-- Moved twice: both earlier days kept, in order.
update public.deliveries set booked_for = '2026-10-14' where id = 'cccccccc-5555-0000-0000-000000000001';
update public.deliveries set booked_for = '2026-10-15', notes = 'Truck broke down' where id = 'cccccccc-5555-0000-0000-000000000001';
do $$ begin if (select moved_from from public.deliveries where id = 'cccccccc-5555-0000-0000-000000000001') <> array['2026-10-12','2026-10-14']::date[] then raise exception 'TESTFAIL: moves not kept'; end if; end; $$;
-- Received: stamped by the database, the device clock believed when it can be, then frozen.
update public.deliveries set status = 'received', docket_ref = ' D-778 ', received_on_device_at = now() - interval '10 minutes', received_at = '2020-01-01' where id = 'cccccccc-5555-0000-0000-000000000001';
do $$
declare r public.deliveries;
begin
  select * into r from public.deliveries where id = 'cccccccc-5555-0000-0000-000000000001';
  if r.received_at < now() - interval '1 minute' then raise exception 'TESTFAIL: received_at should be stamped now'; end if;
  if r.received_by <> '11111111-5555-0000-0000-000000000002' or r.docket_ref <> 'D-778' then raise exception 'TESTFAIL: receipt not stamped'; end if;
  if r.received_on_device_at > now() - interval '9 minutes' then raise exception 'TESTFAIL: a believable device clock should be kept'; end if;
end; $$;
select tests.expect_error($$ update public.deliveries set notes = 'x' where id = 'cccccccc-5555-0000-0000-000000000001' $$, 'received and does not change');
select tests.expect_error($$ delete from public.deliveries where id = 'cccccccc-5555-0000-0000-000000000001' $$, 'permission denied');
-- Cancelling needs a reason, then freezes.
insert into public.deliveries (id, project_id, booked_for, item) values ('cccccccc-5555-0000-0000-000000000002', 'bbbbbbbb-5555-0000-0000-000000000001', '2026-10-20', 'Sand 6 m3');
select tests.expect_error($$ update public.deliveries set status = 'cancelled' where id = 'cccccccc-5555-0000-0000-000000000002' $$, 'Say why');
update public.deliveries set status = 'cancelled', cancel_reason = 'Not needed — used what was on site' where id = 'cccccccc-5555-0000-0000-000000000002';
do $$ begin if (select cancelled_by from public.deliveries where id = 'cccccccc-5555-0000-0000-000000000002') <> '11111111-5555-0000-0000-000000000002' then raise exception 'TESTFAIL: cancel not stamped'; end if; end; $$;
select tests.expect_error($$ update public.deliveries set status = 'booked' where id = 'cccccccc-5555-0000-0000-000000000002' $$, 'cancelled and does not change');

-- The labourer reads none; the other job's supervisor reads none of this job's.
set local request.jwt.claims = '{"sub":"11111111-5555-0000-0000-000000000003","role":"authenticated"}';
do $$ begin if (select count(*) from public.deliveries) <> 0 then raise exception 'TESTFAIL: a labourer reads deliveries'; end if; end; $$;
select tests.expect_error($$ insert into public.deliveries (project_id, booked_for, item) values ('bbbbbbbb-5555-0000-0000-000000000001', '2026-10-12', 'Sand') $$, 'row-level security');
set local request.jwt.claims = '{"sub":"11111111-5555-0000-0000-000000000001","role":"authenticated"}';
do $$ begin if (select count(*) from public.deliveries where project_id = 'bbbbbbbb-5555-0000-0000-000000000001') <> 2 then raise exception 'TESTFAIL: the supervisor should read the job''s deliveries'; end if; end; $$;

reset role;
select tests.expect_error($$ delete from public.deliveries where id = 'cccccccc-5555-0000-0000-000000000002' $$, 'never changed or removed');
rollback;
