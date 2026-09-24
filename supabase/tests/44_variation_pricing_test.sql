-- Pricing a variation: keepers set the estimate and the agreed value; a call that does not mention the estimate keeps it;
-- negatives refused; a leading hand refused.
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
  ('11111111-cccc-0000-0000-000000000001', 'admin.px@example.com'),
  ('11111111-cccc-0000-0000-000000000002', 'lh.px@example.com');
insert into public.organisations (id, name, code) values ('aaaaaaaa-cccc-0000-0000-000000000001', 'Price Civil', 'PXC');
insert into public.projects (id, org_id, name, code) values ('bbbbbbbb-cccc-0000-0000-000000000001', 'aaaaaaaa-cccc-0000-0000-000000000001', 'Price Job', 'X101');
insert into public.project_members (project_id, user_id, role) values
  ('bbbbbbbb-cccc-0000-0000-000000000001', '11111111-cccc-0000-0000-000000000001', 'admin'),
  ('bbbbbbbb-cccc-0000-0000-000000000001', '11111111-cccc-0000-0000-000000000002', 'leading_hand');
insert into public.variation_register (id, project_id, title, raised_on)
values ('cccccccc-cccc-0000-0000-000000000001', 'bbbbbbbb-cccc-0000-0000-000000000001', 'Extra trenching', '2026-09-16');

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-cccc-0000-0000-000000000001","role":"authenticated"}';
-- From the tab: estimate set, nothing agreed yet.
select public.set_variation_details('cccccccc-cccc-0000-0000-000000000001', 'VR-7', null, 'priced from the diary', 4200, false);
do $$
declare r record;
begin
  select * into r from public.variation_register where id = 'cccccccc-cccc-0000-0000-000000000001';
  if r.estimated_cost <> 4200 or r.agreed_cost is not null or r.vr_ref <> 'VR-7' then raise exception 'TESTFAIL: estimate not set: % % %', r.estimated_cost, r.agreed_cost, r.vr_ref; end if;
end; $$;
-- The tracker's old call (no estimate mentioned) keeps the estimate and sets the agreed value.
select public.set_variation_details('cccccccc-cccc-0000-0000-000000000001', 'VR-7', 3900, null);
do $$
declare r record;
begin
  select * into r from public.variation_register where id = 'cccccccc-cccc-0000-0000-000000000001';
  if r.estimated_cost <> 4200 or r.agreed_cost <> 3900 then raise exception 'TESTFAIL: the old call should keep the estimate: % %', r.estimated_cost, r.agreed_cost; end if;
end; $$;
-- Clearing the estimate on purpose.
select public.set_variation_details('cccccccc-cccc-0000-0000-000000000001', 'VR-7', 3900, null, null, false);
do $$
begin
  if (select estimated_cost from public.variation_register where id = 'cccccccc-cccc-0000-0000-000000000001') is not null then raise exception 'TESTFAIL: estimate should clear'; end if;
end; $$;
select tests.expect_error($$ select public.set_variation_details('cccccccc-cccc-0000-0000-000000000001', null, -1, null) $$, 'cannot be negative');
select tests.expect_error($$ select public.set_variation_details('cccccccc-cccc-0000-0000-000000000001', null, null, null, -5, false) $$, 'cannot be negative');
set local request.jwt.claims = '{"sub":"11111111-cccc-0000-0000-000000000002","role":"authenticated"}';
select tests.expect_error($$ select public.set_variation_details('cccccccc-cccc-0000-0000-000000000001', null, 100, null) $$, 'keeps the registers');

rollback;
