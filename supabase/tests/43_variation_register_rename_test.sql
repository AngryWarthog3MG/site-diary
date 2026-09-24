-- Renaming a variation on the register: keepers only, a name is needed, the reference is tidied, the diary rows never move.
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
  ('11111111-bbbb-0000-0000-000000000001', 'admin.vr@example.com'),
  ('11111111-bbbb-0000-0000-000000000002', 'lh.vr@example.com'),
  ('11111111-bbbb-0000-0000-000000000003', 'admin2.vr@example.com');
insert into public.organisations (id, name, code) values ('aaaaaaaa-bbbb-0000-0000-000000000001', 'Rename Civil', 'RNC');
insert into public.projects (id, org_id, name, code) values
  ('bbbbbbbb-bbbb-0000-0000-000000000001', 'aaaaaaaa-bbbb-0000-0000-000000000001', 'Rename Job', 'R101'),
  ('bbbbbbbb-bbbb-0000-0000-000000000002', 'aaaaaaaa-bbbb-0000-0000-000000000001', 'Other Job', 'R102');
insert into public.project_members (project_id, user_id, role) values
  ('bbbbbbbb-bbbb-0000-0000-000000000001', '11111111-bbbb-0000-0000-000000000001', 'admin'),
  ('bbbbbbbb-bbbb-0000-0000-000000000001', '11111111-bbbb-0000-0000-000000000002', 'leading_hand'),
  ('bbbbbbbb-bbbb-0000-0000-000000000002', '11111111-bbbb-0000-0000-000000000003', 'admin');
-- A register entry as the diary trigger would have born it: the supervisor's words as the title.
insert into public.variation_register (id, project_id, title, raised_on)
values ('cccccccc-bbbb-0000-0000-000000000001', 'bbbbbbbb-bbbb-0000-0000-000000000001', 'vac trailer trenching along the west fence for the comms', '2026-09-16');

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-bbbb-0000-0000-000000000001","role":"authenticated"}';
select public.update_variation_register('cccccccc-bbbb-0000-0000-000000000001', '  West fence  comms trenching ', ' VR-0012 ');
do $$
declare r record;
begin
  select * into r from public.variation_register where id = 'cccccccc-bbbb-0000-0000-000000000001';
  if r.title <> 'West fence comms trenching' then raise exception 'TESTFAIL: title not renamed/tidied: "%"', r.title; end if;
  if r.vr_ref <> 'VR-0012' then raise exception 'TESTFAIL: reference not tidied: "%"', r.vr_ref; end if;
end; $$;
-- Clearing the reference; a blank name refused.
select public.update_variation_register('cccccccc-bbbb-0000-0000-000000000001', 'West fence comms trenching', '');
do $$
begin
  if (select vr_ref from public.variation_register where id = 'cccccccc-bbbb-0000-0000-000000000001') is not null then raise exception 'TESTFAIL: blank reference should clear it'; end if;
end; $$;
select tests.expect_error($$ select public.update_variation_register('cccccccc-bbbb-0000-0000-000000000001', '   ', null) $$, 'needs a name');

-- Not a keeper: the leading hand; not on the job: the other admin.
set local request.jwt.claims = '{"sub":"11111111-bbbb-0000-0000-000000000002","role":"authenticated"}';
select tests.expect_error($$ select public.update_variation_register('cccccccc-bbbb-0000-0000-000000000001', 'Mine now', null) $$, 'keeps the registers');
set local request.jwt.claims = '{"sub":"11111111-bbbb-0000-0000-000000000003","role":"authenticated"}';
select tests.expect_error($$ select public.update_variation_register('cccccccc-bbbb-0000-0000-000000000001', 'Mine now', null) $$, 'keeps the registers');
-- A direct write is still refused for everyone (there is no update policy).
set local request.jwt.claims = '{"sub":"11111111-bbbb-0000-0000-000000000001","role":"authenticated"}';
do $$
declare n integer;
begin
  update public.variation_register set title = 'Direct' where id = 'cccccccc-bbbb-0000-0000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'TESTFAIL: a direct update reached the register'; end if;
end; $$;

rollback;
