-- The hazardous chemicals register: who reads it, who keeps it, and what a sheet is.
--
-- The one that matters most is the first: a LABOURER must be able to read this register.
-- Every other record table refuses them (20260915140000). Regulation 346(3) requires the
-- register be readily accessible to the workers involved in using, handling or storing the
-- chemical, so locking the labourer out would breach the regulation the table exists for.
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
  ('55555555-5555-5555-5555-555555555555', 'lab@example.com');
insert into public.organisations (id, name, code) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Kingsbridge Civil', 'KBS');
insert into public.projects (id, org_id, name, code) values ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Northern', 'C001');
insert into public.project_members (project_id, user_id, role) values
  ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'supervisor'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'leading_hand'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '55555555-5555-5555-5555-555555555555', 'labourer');

-- The supervisor keeps the company's product list and its sheets.
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;
insert into public.chemical_products (id, org_id, name, manufacturer, hazard_classes, dg_class, created_by)
values ('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', '  Diesel   fuel ', 'BP', array['flammable_liquid'], '3', '11111111-1111-1111-1111-111111111111');
insert into public.chemical_sds (id, product_id, issued_on, version, file_path, created_by)
values ('dddddddd-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', '2025-02-01', '3.1',
        'aaaaaaaa-0000-0000-0000-000000000001/cccccccc-0000-0000-0000-000000000001/dddddddd-0000-0000-0000-000000000001.pdf',
        '11111111-1111-1111-1111-111111111111');
do $$ begin
  assert (select name from public.chemical_products where id = 'cccccccc-0000-0000-0000-000000000001') = 'Diesel fuel',
    'the product name was not tidied to single spaces';
  raise notice 'PASS  a supervisor records a product and its sheet';
end $$;

-- One product per name per organisation, however it is spaced or cased.
select tests.expect_error($q$
  insert into public.chemical_products (org_id, name) values ('aaaaaaaa-0000-0000-0000-000000000001', 'DIESEL FUEL')
$q$, 'duplicate key');

-- A sheet is a record: retired, never rewritten, never deleted.
select tests.expect_error($q$
  update public.chemical_sds set issued_on = '2026-01-01' where id = 'dddddddd-0000-0000-0000-000000000001'
$q$, 'retired and replaced');
-- A delete finds no row it is allowed to touch, so it removes nothing and raises nothing.
-- The freeze trigger stands behind that for anything holding wider rights.
delete from public.chemical_sds where id = 'dddddddd-0000-0000-0000-000000000001';
do $$ begin
  assert (select count(*) from public.chemical_sds where id = 'dddddddd-0000-0000-0000-000000000001') = 1,
    'a safety data sheet was deleted';
end $$;
-- Retiring it is the allowed update.
update public.chemical_sds set active = false where id = 'dddddddd-0000-0000-0000-000000000001';
update public.chemical_sds set active = true where id = 'dddddddd-0000-0000-0000-000000000001';
do $$ begin raise notice 'PASS  a safety data sheet is retired, not rewritten or deleted'; end $$;

-- The leading hand says what is on this site; they do not keep the company list.
reset role;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
set local role authenticated;
insert into public.project_chemicals (project_id, product_id, location, quantity, created_by)
values ('bbbbbbbb-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', 'Compound bund', '1000 L', '22222222-2222-2222-2222-222222222222');
select tests.expect_error($q$
  insert into public.chemical_products (org_id, name) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Acetylene')
$q$, 'row-level security');
select tests.expect_error($q$
  insert into public.chemical_sds (product_id, issued_on) values ('cccccccc-0000-0000-0000-000000000001', '2026-01-01')
$q$, 'row-level security');
do $$ begin raise notice 'PASS  a leading hand puts a chemical on site but does not keep the company list'; end $$;

-- THE POINT OF THIS SUITE: the labourer reads the register, and only reads it.
reset role;
select set_config('request.jwt.claims', '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  assert (select count(*) from public.chemical_products) = 1, 'a labourer cannot see the chemicals';
  assert (select count(*) from public.chemical_sds) = 1, 'a labourer cannot see the safety data sheets';
  assert (select count(*) from public.project_chemicals) = 1, 'a labourer cannot see what is on their site';
  assert (select count(*) from public.entries) = 0, 'the labourer read lock is broken elsewhere';
  raise notice 'PASS  a labourer reads the register and its sheets — reg. 346(3)';
end $$;
select tests.expect_error($q$
  insert into public.chemical_products (org_id, name) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Petrol')
$q$, 'row-level security');
select tests.expect_error($q$
  insert into public.project_chemicals (project_id, product_id) values ('bbbbbbbb-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001')
$q$, 'row-level security');
-- An update reaches no row the labourer is allowed to write, so it changes nothing and
-- raises nothing. What matters is the value afterwards, so that is what is asserted.
update public.project_chemicals set location = 'my ute' where product_id = 'cccccccc-0000-0000-0000-000000000001';
do $$ begin
  assert (select location from public.project_chemicals where product_id = 'cccccccc-0000-0000-0000-000000000001') = 'Compound bund',
    'a labourer changed the register';
  raise notice 'PASS  a labourer writes nothing here';
end $$;

-- Someone from another company sees none of it.
reset role;
insert into auth.users (id, email) values ('99999999-9999-9999-9999-999999999999', 'other@example.com');
insert into public.organisations (id, name, code) values ('aaaaaaaa-0000-0000-0000-000000000002', 'Somebody Else', 'SE');
insert into public.projects (id, org_id, name, code) values ('bbbbbbbb-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000002', 'Theirs', 'X001');
insert into public.project_members (project_id, user_id, role) values ('bbbbbbbb-0000-0000-0000-000000000002', '99999999-9999-9999-9999-999999999999', 'admin');
select set_config('request.jwt.claims', '{"sub":"99999999-9999-9999-9999-999999999999","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  assert (select count(*) from public.chemical_products) = 0, 'another organisation read the register';
  assert (select count(*) from public.chemical_sds) = 0, 'another organisation read the sheets';
  raise notice 'PASS  the register belongs to its own organisation';
end $$;

reset role;
select set_config('request.jwt.claims', '', true);
do $$ begin raise notice 'ALL CHEMICALS TESTS PASSED'; end $$;
rollback;
