-- Orders and plant issues: numbered by the database, moved along with stamps, frozen once finished.
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
insert into public.organisations (id, name, code) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Kingsbridge Civil', 'KBS');
insert into public.projects (id, org_id, name, code) values ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Northern', 'C001');
insert into public.project_members (project_id, user_id, role) values
  ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'supervisor'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'leading_hand'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'pm');

-- The leading hand raises two: a material and a plant issue. Numbers come from the database.
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
set local role authenticated;
insert into public.orders (id, project_id, kind, item, quantity, urgent, raised_by, status, seq, ordered_at)
values ('dddddddd-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'material', '  Diesel ', '400 L', true, '22222222-2222-2222-2222-222222222222', 'done', 99, now());
insert into public.orders (id, project_id, kind, item, plant, raised_by)
values ('dddddddd-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000001', 'plant_issue', 'Work light not working', 'EX03', '22222222-2222-2222-2222-222222222222');
do $$ declare o public.orders; begin
  select * into o from public.orders where id = 'dddddddd-0000-0000-0000-000000000001';
  assert o.seq = 1 and o.status = 'open' and o.ordered_at is null and o.item = 'Diesel', 'born open, numbered, trimmed';
  assert (select seq from public.orders where id = 'dddddddd-0000-0000-0000-000000000002') = 2, 'second number';
  raise notice 'PASS  requests are born open and numbered by the database';
end $$;
-- The raiser can correct an open request, and remove their own open one.
update public.orders set quantity = '600 L' where id = 'dddddddd-0000-0000-0000-000000000001';
do $$ begin assert (select quantity from public.orders where id = 'dddddddd-0000-0000-0000-000000000001') = '600 L', 'open request not editable'; end $$;
insert into public.orders (id, project_id, kind, item, raised_by)
values ('dddddddd-0000-0000-0000-000000000003', 'bbbbbbbb-0000-0000-0000-000000000001', 'material', 'Oops', '22222222-2222-2222-2222-222222222222');
delete from public.orders where id = 'dddddddd-0000-0000-0000-000000000003';
do $$ begin assert (select count(*) from public.orders where id = 'dddddddd-0000-0000-0000-000000000003') = 0, 'own open not removable'; end $$;
reset role;

-- The PM orders it (with supplier and reference), then it is received. Stamps are the database's.
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
set local role authenticated;
update public.orders set status = 'ordered', supplier = 'Ampol', order_ref = 'PO-118', ordered_at = timestamptz '2000-01-01' where id = 'dddddddd-0000-0000-0000-000000000001';
do $$ declare o public.orders; begin
  select * into o from public.orders where id = 'dddddddd-0000-0000-0000-000000000001';
  assert o.status = 'ordered' and o.ordered_at >= now() - interval '1 minute' and o.ordered_by = '33333333-3333-3333-3333-333333333333' and o.supplier = 'Ampol', 'ordered not stamped';
  raise notice 'PASS  the PM orders; the database stamps it';
end $$;
select tests.expect_error($q$
  update public.orders set quantity = '800 L' where id = 'dddddddd-0000-0000-0000-000000000001'
$q$, 'does not change');
-- Not ordered after all: back to open leaves no supplier or reference behind.
update public.orders set status = 'open' where id = 'dddddddd-0000-0000-0000-000000000001';
do $$ declare o public.orders; begin
  select * into o from public.orders where id = 'dddddddd-0000-0000-0000-000000000001';
  assert o.status = 'open' and o.ordered_at is null and o.supplier is null and o.order_ref is null, 'back to open kept order details';
end $$;
update public.orders set status = 'ordered', supplier = 'Ampol', order_ref = 'PO-118' where id = 'dddddddd-0000-0000-0000-000000000001';
select tests.expect_error($q$
  insert into public.orders (project_id, kind, item, raised_by) values ('bbbbbbbb-0000-0000-0000-000000000001', 'material', 'PM cannot raise', '33333333-3333-3333-3333-333333333333')
$q$, 'row-level security');
reset role;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;
insert into public.order_updates (order_id, body, created_by) values ('dddddddd-0000-0000-0000-000000000001', 'Delivery Thursday', '11111111-1111-1111-1111-111111111111');
update public.orders set status = 'done', done_note = 'Delivered to the compound' where id = 'dddddddd-0000-0000-0000-000000000001';
do $$ declare o public.orders; begin
  select * into o from public.orders where id = 'dddddddd-0000-0000-0000-000000000001';
  assert o.status = 'done' and o.done_at is not null and o.done_by = '11111111-1111-1111-1111-111111111111' and o.ordered_at is not null, 'done not stamped or ordered stamp lost';
end $$;
select tests.expect_error($q$
  update public.orders set status = 'open' where id = 'dddddddd-0000-0000-0000-000000000001'
$q$, 'finished request is frozen');
select tests.expect_error($q$
  insert into public.order_updates (order_id, body, created_by) values ('dddddddd-0000-0000-0000-000000000001', 'too late', '11111111-1111-1111-1111-111111111111')
$q$, 'no more updates');
select tests.expect_error($q$
  update public.orders set status = 'cancelled' where id = 'dddddddd-0000-0000-0000-000000000002'
$q$, 'say why');
update public.orders set status = 'cancelled', cancel_reason = 'Fixed by the fitter on site' where id = 'dddddddd-0000-0000-0000-000000000002';
do $$ begin
  assert (select cancelled_at from public.orders where id = 'dddddddd-0000-0000-0000-000000000002') is not null, 'cancel not stamped';
  raise notice 'PASS  done and cancelled are stamped and frozen; a cancel needs a reason';
end $$;
select tests.expect_error($q$
  update public.orders set notified_at = now() where id = 'dddddddd-0000-0000-0000-000000000001'
$q$, 'recorded by the server');
reset role;
-- Nothing that has moved is ever deleted, by anyone.
select tests.expect_error($q$
  delete from public.orders where id = 'dddddddd-0000-0000-0000-000000000001'
$q$, 'part of the record');
select tests.expect_error($q$
  delete from public.order_updates where order_id = 'dddddddd-0000-0000-0000-000000000001'
$q$, 'never changed or removed');
do $$ begin raise notice 'PASS  a moved request and its updates stay'; end $$;
select set_config('request.jwt.claims', '', true);
do $$ begin raise notice 'ALL ORDERS TESTS PASSED'; end $$;
rollback;
