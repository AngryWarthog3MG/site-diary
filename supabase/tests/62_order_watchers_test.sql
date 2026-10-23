-- Order watchers (README R165): an office person puts themselves on the company's list and takes themselves off; a
-- supervisor may not; the two stamps on a request are the server's — no signed-in account sets them.
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
  ('11111111-ee62-0000-0000-000000000001', 'admin.ow@example.com'),
  ('11111111-ee62-0000-0000-000000000002', 'sup.ow@example.com'),
  ('11111111-ee62-0000-0000-000000000003', 'pm.ow@example.com');
insert into public.organisations (id, name, code) values ('aaaaaaaa-ee62-0000-0000-000000000001', 'Watch Civil', 'OWC');
insert into public.projects (id, org_id, name, code) values ('bbbbbbbb-ee62-0000-0000-000000000001', 'aaaaaaaa-ee62-0000-0000-000000000001', 'Watch Job', 'X601');
insert into public.project_members (project_id, user_id, role) values
  ('bbbbbbbb-ee62-0000-0000-000000000001', '11111111-ee62-0000-0000-000000000001', 'admin'),
  ('bbbbbbbb-ee62-0000-0000-000000000001', '11111111-ee62-0000-0000-000000000002', 'supervisor'),
  ('bbbbbbbb-ee62-0000-0000-000000000001', '11111111-ee62-0000-0000-000000000003', 'pm');

set local role authenticated;

-- The admin watches, changes the gap, sees their row; the PM may too; the supervisor may not; nobody adds another.
set local request.jwt.claims = '{"sub":"11111111-ee62-0000-0000-000000000001","role":"authenticated"}';
insert into public.order_watchers (org_id, user_id) values ('aaaaaaaa-ee62-0000-0000-000000000001', '11111111-ee62-0000-0000-000000000001');
update public.order_watchers set every_hours = 12 where user_id = '11111111-ee62-0000-0000-000000000001';
select tests.expect_error(
  $q$insert into public.order_watchers (org_id, user_id) values ('aaaaaaaa-ee62-0000-0000-000000000001', '11111111-ee62-0000-0000-000000000003')$q$,
  'row-level security');
select tests.expect_error(
  $q$update public.order_watchers set every_hours = 0 where user_id = '11111111-ee62-0000-0000-000000000001'$q$,
  'check');
do $$
begin
  if (select every_hours from public.order_watchers where user_id = '11111111-ee62-0000-0000-000000000001') <> 12 then raise exception 'TESTFAIL: the gap did not change'; end if;
end; $$;
set local request.jwt.claims = '{"sub":"11111111-ee62-0000-0000-000000000003","role":"authenticated"}';
insert into public.order_watchers (org_id, user_id) values ('aaaaaaaa-ee62-0000-0000-000000000001', '11111111-ee62-0000-0000-000000000003');
do $$
begin
  if (select count(*) from public.order_watchers) <> 2 then raise exception 'TESTFAIL: the office does not see the company list'; end if;
end; $$;
set local request.jwt.claims = '{"sub":"11111111-ee62-0000-0000-000000000002","role":"authenticated"}';
select tests.expect_error(
  $q$insert into public.order_watchers (org_id, user_id) values ('aaaaaaaa-ee62-0000-0000-000000000001', '11111111-ee62-0000-0000-000000000002')$q$,
  'row-level security');
do $$
begin
  if (select count(*) from public.order_watchers) <> 0 then raise exception 'TESTFAIL: the supervisor read the watch list'; end if;
end; $$;

-- A request is born unstamped, and no phone stamps it.
insert into public.orders (id, project_id, kind, item, raised_by, raised_on_device_at, watchers_notified_at) values
  ('dddddddd-ee62-0000-0000-000000000001', 'bbbbbbbb-ee62-0000-0000-000000000001', 'material', 'Road base 20 t', '11111111-ee62-0000-0000-000000000002', now(), now());
do $$
begin
  if (select watchers_notified_at from public.orders where id = 'dddddddd-ee62-0000-0000-000000000001') is not null then raise exception 'TESTFAIL: born stamped'; end if;
end; $$;
select tests.expect_error(
  $q$update public.orders set watchers_notified_at = now() where id = 'dddddddd-ee62-0000-0000-000000000001'$q$,
  'recorded by the server');
select tests.expect_error(
  $q$update public.orders set last_reminded_at = now() where id = 'dddddddd-ee62-0000-0000-000000000001'$q$,
  'recorded by the server');

-- The admin takes themselves off.
set local request.jwt.claims = '{"sub":"11111111-ee62-0000-0000-000000000001","role":"authenticated"}';
delete from public.order_watchers where user_id = '11111111-ee62-0000-0000-000000000001';
do $$
begin
  if exists (select 1 from public.order_watchers where user_id = '11111111-ee62-0000-0000-000000000001') then raise exception 'TESTFAIL: the admin is still on the list'; end if;
end; $$;

rollback;
