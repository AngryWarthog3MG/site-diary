-- Photographs on a plant prestart (README R193): up to ten, each under the prestart's own folder, one of each; named
-- in the update that signs it; frozen with the signed check; a check with none is as it always was.
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
insert into auth.users (id, email) values ('11111111-7777-0000-0000-000000000001', 'sup.plantphoto@example.com');
insert into public.organisations (id, name, code) values ('aaaaaaaa-7777-0000-0000-000000000001', 'Plant Photo Civil', 'PPC');
insert into public.projects (id, org_id, name, code) values ('bbbbbbbb-7777-0000-0000-000000000001', 'aaaaaaaa-7777-0000-0000-000000000001', 'Plant Photo Job', 'P771');
insert into public.project_members (project_id, user_id, role) values ('bbbbbbbb-7777-0000-0000-000000000001', '11111111-7777-0000-0000-000000000001', 'supervisor');
insert into public.plant_register (id, org_id, name, kind) values ('eeeeeeee-7777-0000-0000-000000000001', 'aaaaaaaa-7777-0000-0000-000000000001', 'Plate compactor', 'other');
insert into public.project_plant (project_id, plant_id) values ('bbbbbbbb-7777-0000-0000-000000000001', 'eeeeeeee-7777-0000-0000-000000000001');
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-7777-0000-0000-000000000001","role":"authenticated"}';

-- 1. A check with no photographs is as it always was.
insert into public.plant_prestarts (id, project_id, plant_id, prestart_date, operator_name, checks, fit_for_use, conducted_by) values
  ('dddddddd-7777-0000-0000-000000000001', 'bbbbbbbb-7777-0000-0000-000000000001', 'eeeeeeee-7777-0000-0000-000000000001', app.perth_today(), 'Sue Super',
   '[{"key":"walk","label":"Walk around","result":"ok"}]', true, '11111111-7777-0000-0000-000000000001');
do $$ begin
  if (select photo_paths from public.plant_prestarts where id = 'dddddddd-7777-0000-0000-000000000001') <> '{}' then raise exception 'TESTFAIL: no photographs is an empty list'; end if;
end; $$;
do $$ begin raise notice 'PASS  1 a check with no photographs is as it was'; end $$;

-- 2. Photographs sit in the check's own folder, one of each, ten at most.
select tests.expect_error($$ update public.plant_prestarts set photo_paths = '{bbbbbbbb-7777-0000-0000-000000000001/plant/dddddddd-7777-0000-0000-000000000002/photo-1.jpg}' where id = 'dddddddd-7777-0000-0000-000000000001' $$, 'under its own folder');
select tests.expect_error($$ update public.plant_prestarts set photo_paths = '{bbbbbbbb-7777-0000-0000-000000000001/plant/dddddddd-7777-0000-0000-000000000001/}' where id = 'dddddddd-7777-0000-0000-000000000001' $$, 'under its own folder');
select tests.expect_error($$ update public.plant_prestarts set photo_paths = '{bbbbbbbb-7777-0000-0000-000000000001/plant/dddddddd-7777-0000-0000-000000000001/a.jpg,bbbbbbbb-7777-0000-0000-000000000001/plant/dddddddd-7777-0000-0000-000000000001/a.jpg}' where id = 'dddddddd-7777-0000-0000-000000000001' $$, 'listed once');
select tests.expect_error($$ update public.plant_prestarts set photo_paths = (select array_agg('bbbbbbbb-7777-0000-0000-000000000001/plant/dddddddd-7777-0000-0000-000000000001/p' || g || '.jpg') from generate_series(1, 11) g) where id = 'dddddddd-7777-0000-0000-000000000001' $$, 'plant_prestarts_photos_at_most_ten');
select tests.expect_error($$ insert into public.plant_prestarts (id, project_id, plant_id, prestart_date, operator_name, checks, fit_for_use, conducted_by, photo_paths) values
  ('dddddddd-7777-0000-0000-000000000003', 'bbbbbbbb-7777-0000-0000-000000000001', 'eeeeeeee-7777-0000-0000-000000000001', app.perth_today(), 'Sue Super', '[{"key":"walk","label":"Walk around","result":"ok"}]', true, '11111111-7777-0000-0000-000000000001',
   '{somewhere/else/photo.jpg}') $$, 'under its own folder');
do $$ begin raise notice 'PASS  2 own folder, one of each, ten at most'; end $$;

-- 3. Named in the update that signs it, and kept.
update public.plant_prestarts
   set signature_path = 'bbbbbbbb-7777-0000-0000-000000000001/plant/dddddddd-7777-0000-0000-000000000001/sig.png',
       completed_on_device_at = now(),
       photo_paths = '{bbbbbbbb-7777-0000-0000-000000000001/plant/dddddddd-7777-0000-0000-000000000001/photo-1.jpg,bbbbbbbb-7777-0000-0000-000000000001/plant/dddddddd-7777-0000-0000-000000000001/photo-2.jpg}'
 where id = 'dddddddd-7777-0000-0000-000000000001';
do $$
declare r public.plant_prestarts;
begin
  select * into r from public.plant_prestarts where id = 'dddddddd-7777-0000-0000-000000000001';
  if r.completed_at is null or cardinality(r.photo_paths) <> 2 then raise exception 'TESTFAIL: signed with its two photographs: %', row_to_json(r)::text; end if;
end; $$;
do $$ begin raise notice 'PASS  3 named when signed, and kept'; end $$;

-- 4. Frozen with the signed check: none added, none taken off. Under RLS a signed check is not updatable at all (the
--    statement takes no row); without RLS the trigger refuses it by name.
update public.plant_prestarts set photo_paths = '{}' where id = 'dddddddd-7777-0000-0000-000000000001';
do $$ begin
  if (select cardinality(photo_paths) from public.plant_prestarts where id = 'dddddddd-7777-0000-0000-000000000001') <> 2 then raise exception 'TESTFAIL: a signed check lost its photographs'; end if;
end; $$;
reset role;
select tests.expect_error($$ update public.plant_prestarts set photo_paths = '{}' where id = 'dddddddd-7777-0000-0000-000000000001' $$, 'signed and cannot be modified');
select tests.expect_error($$ update public.plant_prestarts set photo_paths = photo_paths || '{bbbbbbbb-7777-0000-0000-000000000001/plant/dddddddd-7777-0000-0000-000000000001/photo-3.jpg}'::text[] where id = 'dddddddd-7777-0000-0000-000000000001' $$, 'signed and cannot be modified');
do $$ begin raise notice 'PASS  4 frozen with the signed check'; end $$;

rollback;
