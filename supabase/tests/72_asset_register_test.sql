-- The asset register (README R186): a machine on the plant register is an asset without moving a row; a machine's
-- name and records stay the plant register's; a profile's next due counts from the last DOING on either records
-- table; the record that discharges a profile closes its action; a lower meter reading needs a new meter; one open
-- custody per asset; the labourer reads none of it; the sweep alone raises actions; the action register carries them.
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
  ('00000000-0000-0000-ac72-000000000001', 'sup72@example.com'),
  ('00000000-0000-0000-ac72-000000000003', 'lab72@example.com'),
  ('00000000-0000-0000-ac72-000000000005', 'pm72@example.com'),
  ('00000000-0000-0000-ac72-000000000006', 'sup72b@example.com');
insert into public.profiles (id, email, full_name) values
  ('00000000-0000-0000-ac72-000000000001', 'sup72@example.com', 'Sue Pervisor'),
  ('00000000-0000-0000-ac72-000000000003', 'lab72@example.com', 'Sam Labourer'),
  ('00000000-0000-0000-ac72-000000000005', 'pm72@example.com', 'Pat Manager'),
  ('00000000-0000-0000-ac72-000000000006', 'sup72b@example.com', 'Other Company')
  on conflict (id) do nothing;
insert into public.organisations (id, name, code) values
  ('aaaaaaaa-0000-0000-ac72-000000000001', 'Kingsbridge Civil', 'KB72'),
  ('aaaaaaaa-0000-0000-ac72-000000000002', 'Other Civil', 'OC72');
insert into public.projects (id, org_id, name, code) values
  ('bbbbbbbb-0000-0000-ac72-000000000001', 'aaaaaaaa-0000-0000-ac72-000000000001', 'Northern', 'C072'),
  ('bbbbbbbb-0000-0000-ac72-000000000002', 'aaaaaaaa-0000-0000-ac72-000000000002', 'Elsewhere', 'X072');
insert into public.project_members (project_id, user_id, role) values
  ('bbbbbbbb-0000-0000-ac72-000000000001', '00000000-0000-0000-ac72-000000000001', 'supervisor'),
  ('bbbbbbbb-0000-0000-ac72-000000000001', '00000000-0000-0000-ac72-000000000003', 'labourer'),
  ('bbbbbbbb-0000-0000-ac72-000000000001', '00000000-0000-0000-ac72-000000000005', 'pm'),
  ('bbbbbbbb-0000-0000-ac72-000000000002', '00000000-0000-0000-ac72-000000000006', 'supervisor');

-- 1. A machine on the plant register is an asset on its own, carrying the machine's name; nothing of the machine's is
--    kept twice. The other company's machine is theirs.
insert into public.plant_register (id, org_id, name, kind, plant_no, ownership, supplier) values
  ('dddddddd-0000-0000-ac72-000000000001', 'aaaaaaaa-0000-0000-ac72-000000000001', '14t Excavator', 'excavator', 'KBS-14', 'wet_hire', 'Coates'),
  ('dddddddd-0000-0000-ac72-000000000002', 'aaaaaaaa-0000-0000-ac72-000000000002', 'Their Roller', 'roller', 'X-1', 'own', null);
do $$ declare r record; begin
  select * into r from public.asset_register where plant_id = 'dddddddd-0000-0000-ac72-000000000001';
  assert r.id is not null, 'the machine got no asset row';
  assert r.name = '14t Excavator' and r.asset_no = 'KBS-14' and r.asset_class = 'plant' and r.category = 'excavator' and r.ownership = 'hired' and r.supplier = 'Coates', 'the view does not carry the machine: ' || row_to_json(r)::text;
  assert (select count(*) from public.assets where org_id = 'aaaaaaaa-0000-0000-ac72-000000000001') = 1, 'one asset per machine';
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-ac72-000000000001","role":"authenticated"}', true);
set local role authenticated;
select tests.expect_error($q$ update public.assets set name = 'Renamed' where plant_id = 'dddddddd-0000-0000-ac72-000000000001' $q$, 'kept on the plant register');
select tests.expect_error($q$ update public.assets set active = false, retired_reason = 'sold' where plant_id = 'dddddddd-0000-0000-ac72-000000000001' $q$, 'retired on the plant register');
select tests.expect_error($q$ insert into public.assets (org_id, plant_id, asset_class) values ('aaaaaaaa-0000-0000-ac72-000000000001', 'dddddddd-0000-0000-ac72-000000000002', 'plant') $q$, 'another company');
-- Where it is kept, its barcode and serial are this register's to keep.
update public.assets set location = 'Northern laydown', barcode = 'KB-0001' where plant_id = 'dddddddd-0000-0000-ac72-000000000001';
do $$ begin assert (select location from public.asset_register where plant_id = 'dddddddd-0000-0000-ac72-000000000001') = 'Northern laydown', 'location not kept'; end $$;
-- Retiring the machine retires the asset, through the view.
reset role;
update public.plant_register set active = false where id = 'dddddddd-0000-0000-ac72-000000000002';
do $$ begin assert (select active from public.asset_register where plant_id = 'dddddddd-0000-0000-ac72-000000000002') = false, 'the view did not follow the machine''s retirement'; end $$;
do $$ begin raise notice 'PASS  1 a machine is an asset without moving a row; its facts stay the plant register''s'; end $$;

-- 2. Anything else: added by a supervisor, named, numbered once per company; retired only with a reason; never deleted.
set local role authenticated;
insert into public.assets (id, org_id, asset_class, name, asset_no, barcode, category, ownership, location) values
  ('eeeeeeee-0000-0000-ac72-000000000001', 'aaaaaaaa-0000-0000-ac72-000000000001', 'electrical', '15 m extension lead', 'EL-001', 'KB-0002', 'Extension lead', 'own', 'Site office'),
  ('eeeeeeee-0000-0000-ac72-000000000002', 'aaaaaaaa-0000-0000-ac72-000000000001', 'fire', '9 kg ABE extinguisher', 'EXT-001', null, null, 'own', 'Site office');
select tests.expect_error($q$ insert into public.assets (org_id, asset_class, name, asset_no) values ('aaaaaaaa-0000-0000-ac72-000000000001', 'electrical', 'Another lead', 'EL-001') $q$, 'assets_no_idx');
select tests.expect_error($q$ insert into public.assets (org_id, asset_class, name, barcode) values ('aaaaaaaa-0000-0000-ac72-000000000001', 'tool', 'A ladder', 'KB-0002') $q$, 'assets_barcode_idx');
select tests.expect_error($q$ insert into public.assets (org_id, asset_class, name) values ('aaaaaaaa-0000-0000-ac72-000000000002', 'tool', 'Theirs') $q$, 'row-level security');
select tests.expect_error($q$ update public.assets set active = false where id = 'eeeeeeee-0000-0000-ac72-000000000002' $q$, 'say why');
-- RLS gives an authenticated delete no row to touch; the trigger refuses even the owner.
reset role;
select tests.expect_error($q$ delete from public.assets where id = 'eeeeeeee-0000-0000-ac72-000000000002' $q$, 'never deleted');
set local role authenticated;
do $$ begin raise notice 'PASS  2 anything else is added, numbered once, retired with a reason, never deleted'; end $$;

-- 3. Profiles: by the calendar, by the meter, or both — never neither; a machine's profile too; assigned to someone in
--    the company. The next due is the first due until one is done.
insert into public.asset_profiles (id, org_id, asset_id, kind, label, basis, every, unit, first_due_on, assigned_to) values
  ('ffffffff-0000-0000-ac72-000000000001', 'aaaaaaaa-0000-0000-ac72-000000000001', 'eeeeeeee-0000-0000-ac72-000000000001', 'test', 'Test and tag', 'AS/NZS 3760', 3, 'month', '2026-01-15', '00000000-0000-0000-ac72-000000000005');
insert into public.asset_profiles (id, org_id, asset_id, kind, label, every_hours, start_hours) values
  ('ffffffff-0000-0000-ac72-000000000002', 'aaaaaaaa-0000-0000-ac72-000000000001', (select id from public.assets where plant_id = 'dddddddd-0000-0000-ac72-000000000001'), 'maintenance', '250-hour service', 250, 1000);
select tests.expect_error($q$ insert into public.asset_profiles (org_id, asset_id, kind, label) values ('aaaaaaaa-0000-0000-ac72-000000000001', 'eeeeeeee-0000-0000-ac72-000000000002', 'inspection', 'Nothing') $q$, 'asset_profiles_one_clock');
select tests.expect_error($q$ insert into public.asset_profiles (org_id, asset_id, kind, label, every, unit) values ('aaaaaaaa-0000-0000-ac72-000000000001', 'eeeeeeee-0000-0000-ac72-000000000002', 'inspection', 'Half', 6, 'month') $q$, 'asset_profiles_calendar_whole');
select tests.expect_error($q$ insert into public.asset_profiles (org_id, asset_id, kind, label, every, unit, first_due_on, assigned_to) values ('aaaaaaaa-0000-0000-ac72-000000000001', 'eeeeeeee-0000-0000-ac72-000000000002', 'inspection', 'X', 6, 'month', '2026-02-01', '00000000-0000-0000-ac72-000000000006') $q$, 'someone in the company');
do $$ begin
  assert app.asset_profile_next_due('ffffffff-0000-0000-ac72-000000000001') = '2026-01-15'::date, 'first due should stand until done';
  assert app.asset_profile_next_due('ffffffff-0000-0000-ac72-000000000002') is null, 'a meter-only profile has no calendar due';
  assert app.asset_profile_due_at_hours('ffffffff-0000-0000-ac72-000000000002') = 1250, 'due at start + interval';
end $$;
do $$ begin raise notice 'PASS  3 a profile has a clock, names someone in the company, and is first due when it says'; end $$;

-- 4. The sweep alone raises actions; one per profile and due day; the action register carries them as origin asset.
select tests.expect_error($q$ insert into public.asset_actions (org_id, asset_id, profile_id, due_on, action) values ('aaaaaaaa-0000-0000-ac72-000000000001', 'eeeeeeee-0000-0000-ac72-000000000001', 'ffffffff-0000-0000-ac72-000000000001', '2026-01-15', 'By hand') $q$, 'raised by its profile');
select tests.expect_error($q$ select public.raise_asset_actions('2026-01-10'::date, 7) $q$, 'permission denied');
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
do $$ declare n integer; begin
  n := public.raise_asset_actions('2026-01-01'::date, 7);
  assert n = 0, 'nothing due within a week of 01/01: ' || n;
  n := public.raise_asset_actions('2026-01-10'::date, 7);
  assert n = 1, 'the test and tag falls due within the week: ' || n;
  n := public.raise_asset_actions('2026-01-10'::date, 7);
  assert n = 0, 'raised once however often it runs: ' || n;
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-ac72-000000000005","role":"authenticated"}', true);
set local role authenticated;
-- The assignee sees their action through the action register, company-wide (no job), naming the asset and the profile.
do $$ declare r record; begin
  select * into r from public.action_register where origin = 'asset' and assigned_to = '00000000-0000-0000-ac72-000000000005';
  assert r.id is not null, 'the assignee cannot see their asset action';
  assert r.record_ref = '15 m extension lead · EL-001' and r.record_title = 'Test and tag' and r.due_on = '2026-01-15'::date and r.project_id is null, 'the register row: ' || row_to_json(r)::text;
end $$;
-- The labourer has no door to actions (R177) and reads no asset, profile or asset action.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-ac72-000000000003","role":"authenticated"}', true);
do $$ begin
  assert (select count(*) from public.assets) = 0, 'a labourer reads no asset';
  assert (select count(*) from public.asset_profiles) = 0, 'a labourer reads no profile';
  assert (select count(*) from public.action_register where origin = 'asset') = 0, 'a labourer reads no asset action';
end $$;
select tests.expect_error($q$ insert into public.assets (org_id, asset_class, name) values ('aaaaaaaa-0000-0000-ac72-000000000001', 'tool', 'Theirs') $q$, 'row-level security');
do $$ begin raise notice 'PASS  4 the sweep raises an action once; the action register carries it; the labourer reads no asset'; end $$;

-- 5. The record that discharges the profile closes the action, and the next due counts from the doing — unless the
--    tag set a date. A machine's record is refused here and taken on the machine's page, naming the profile.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-ac72-000000000001","role":"authenticated"}', true);
select tests.expect_error($q$ insert into public.asset_records (asset_id, kind, done_on, performed_by_name) values ((select id from public.assets where plant_id = 'dddddddd-0000-0000-ac72-000000000001'), 'maintenance', '2026-01-12', 'Mick') $q$, 'machine''s page');
select tests.expect_error($q$ insert into public.asset_records (asset_id, profile_id, kind, done_on, performed_by_name) values ('eeeeeeee-0000-0000-ac72-000000000002', 'ffffffff-0000-0000-ac72-000000000001', 'test', '2026-01-12', 'Mick') $q$, 'another asset');
select tests.expect_error($q$ insert into public.asset_records (asset_id, kind, done_on, performed_by_name) values ('eeeeeeee-0000-0000-ac72-000000000001', 'test', (now() at time zone 'Australia/Perth')::date + 1, 'Mick') $q$, 'future');
select tests.expect_error($q$ insert into public.asset_records (asset_id, kind, done_on, performed_by_name, file_path) values ('eeeeeeee-0000-0000-ac72-000000000001', 'test', '2026-01-12', 'Mick', 'aaaaaaaa-0000-0000-ac72-000000000001/eeeeeeee-0000-0000-ac72-000000000002/x.pdf') $q$, 'own folder');
insert into public.asset_records (id, asset_id, profile_id, kind, done_on, performed_by_name, competence, outcome) values
  ('99999999-0000-0000-ac72-000000000001', 'eeeeeeee-0000-0000-ac72-000000000001', 'ffffffff-0000-0000-ac72-000000000001', 'test', '2026-01-12', 'Mick Sparks', 'Licensed electrician EC 12345', 'pass');
do $$ declare r record; begin
  select * into r from public.asset_actions where profile_id = 'ffffffff-0000-0000-ac72-000000000001' and due_on = '2026-01-15';
  assert r.done_at is not null and r.done_note = 'Discharged by the test recorded on 12/01/2026', 'the record did not close the action: ' || coalesce(r.done_note, 'open');
  assert app.asset_profile_next_due('ffffffff-0000-0000-ac72-000000000001') = '2026-04-12'::date, 'next due counts three months from the doing: ' || app.asset_profile_next_due('ffffffff-0000-0000-ac72-000000000001');
end $$;
reset role;
select tests.expect_error($q$ update public.asset_records set outcome = 'fail' where id = '99999999-0000-0000-ac72-000000000001' $q$, 'never changed or removed');
select tests.expect_error($q$ delete from public.asset_records where id = '99999999-0000-0000-ac72-000000000001' $q$, 'never changed or removed');
set local role authenticated;
-- The tag's own date wins over the interval.
insert into public.asset_records (asset_id, profile_id, kind, done_on, performed_by_name, next_due_on) values
  ('eeeeeeee-0000-0000-ac72-000000000001', 'ffffffff-0000-0000-ac72-000000000001', 'test', '2026-04-10', 'Mick Sparks', '2026-07-01');
do $$ begin assert app.asset_profile_next_due('ffffffff-0000-0000-ac72-000000000001') = '2026-07-01'::date, 'the date on the tag should win'; end $$;
-- The machine's service record, made on the machine's page, names the machine's profile and moves its meter cycle.
select tests.expect_error($q$ insert into public.plant_maintenance_records (plant_id, kind, done_on, performed_by_name, profile_id) values ('dddddddd-0000-0000-ac72-000000000001', 'maintenance', '2026-01-20', 'Mick', 'ffffffff-0000-0000-ac72-000000000001') $q$, 'another asset');
insert into public.plant_maintenance_records (plant_id, kind, done_on, performed_by_name, hour_meter, profile_id) values
  ('dddddddd-0000-0000-ac72-000000000001', 'maintenance', '2026-01-20', 'Mick Diesel', 1260, 'ffffffff-0000-0000-ac72-000000000002');
do $$ begin assert app.asset_profile_due_at_hours('ffffffff-0000-0000-ac72-000000000002') = 1510, 'the service moved the cycle to 1260 + 250'; end $$;
do $$ begin raise notice 'PASS  5 the record discharges the action and moves the next due; a machine''s record is the machine page''s'; end $$;

-- 6. The meter: every source counts; a lower reading needs a new meter; a prestart's hour meter reaches a service.
do $$ declare m record; begin
  select * into m from app.asset_latest_meter((select id from public.assets where plant_id = 'dddddddd-0000-0000-ac72-000000000001'));
  assert m.reading = 1260 and m.source = 'service', 'the service record is the latest reading: ' || coalesce(m.reading::text, 'none');
end $$;
select tests.expect_error($q$ insert into public.asset_meter_readings (asset_id, read_on, reading) values ((select id from public.assets where plant_id = 'dddddddd-0000-0000-ac72-000000000001'), '2026-01-25', 900) $q$, 'a lower reading means a new meter');
insert into public.asset_meter_readings (id, asset_id, read_on, reading, meter_replaced) values
  ('88888888-0000-0000-ac72-000000000001', (select id from public.assets where plant_id = 'dddddddd-0000-0000-ac72-000000000001'), '2026-01-25', 900, true);
reset role;
select tests.expect_error($q$ delete from public.asset_meter_readings where id = '88888888-0000-0000-ac72-000000000001' $q$, 'never changed or removed');
set local role authenticated;
select tests.expect_error($q$ insert into public.asset_meter_readings (asset_id, read_on, reading) values ('eeeeeeee-0000-0000-ac72-000000000001', (now() at time zone 'Australia/Perth')::date + 1, 1) $q$, 'future');
-- A completed prestart's hour meter is a reading; past the due reading, the sweep raises the service.
insert into public.project_plant (project_id, plant_id) values ('bbbbbbbb-0000-0000-ac72-000000000001', 'dddddddd-0000-0000-ac72-000000000001');
insert into public.plant_prestarts (id, project_id, plant_id, prestart_date, operator_name, hour_meter, checks, fit_for_use, conducted_by) values
  ('77777777-0000-0000-ac72-000000000001', 'bbbbbbbb-0000-0000-ac72-000000000001', 'dddddddd-0000-0000-ac72-000000000001', '2026-02-02', 'Sue Pervisor', 1520, '[{"key":"fluids","label":"Fluids","result":"ok"}]'::jsonb, true, '00000000-0000-0000-ac72-000000000001');
-- The signature is the completion (migration 20260910100000); an open prestart's reading does not count.
do $$ declare m record; begin
  select * into m from app.asset_latest_meter((select id from public.assets where plant_id = 'dddddddd-0000-0000-ac72-000000000001'));
  assert m.reading = 900, 'an unsigned prestart is not a reading yet: ' || m.reading;
end $$;
update public.plant_prestarts set signature_path = 'bbbbbbbb-0000-0000-ac72-000000000001/plant/77777777-0000-0000-ac72-000000000001/sig.png' where id = '77777777-0000-0000-ac72-000000000001';
do $$ begin assert (select completed_at from public.plant_prestarts where id = '77777777-0000-0000-ac72-000000000001') is not null, 'the prestart did not complete'; end $$;
do $$ declare m record; begin
  select * into m from app.asset_latest_meter((select id from public.assets where plant_id = 'dddddddd-0000-0000-ac72-000000000001'));
  assert m.reading = 1520 and m.source = 'prestart', 'the prestart is the latest reading: ' || coalesce(m.reading::text, 'none') || ' ' || coalesce(m.source, '');
end $$;
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
do $$ declare n integer; r record; begin
  n := public.raise_asset_actions('2026-02-03'::date, 7);
  assert n = 1, 'the service by hours should be raised: ' || n;
  select * into r from public.asset_actions where profile_id = 'ffffffff-0000-0000-ac72-000000000002';
  assert r.due_on = '2026-02-02'::date and r.action like '250-hour service — 14t Excavator (KBS-14) — due at 1510% h, read 1520% h', 'the action names the readings: ' || r.action;
end $$;
reset role;
do $$ begin raise notice 'PASS  6 every meter source counts, a lower reading needs a new meter, and a prestart reaches a service'; end $$;

-- 7. Custody: one open per asset; who took it is fixed; checked in once; a retired asset is not checked out.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-ac72-000000000001","role":"authenticated"}', true);
set local role authenticated;
insert into public.asset_checkouts (id, org_id, asset_id, project_id, holder_name, due_back_on) values
  ('66666666-0000-0000-ac72-000000000001', 'aaaaaaaa-0000-0000-ac72-000000000001', 'eeeeeeee-0000-0000-ac72-000000000001', 'bbbbbbbb-0000-0000-ac72-000000000001', 'Sam Labourer', '2026-03-01');
select tests.expect_error($q$ insert into public.asset_checkouts (org_id, asset_id, holder_name) values ('aaaaaaaa-0000-0000-ac72-000000000001', 'eeeeeeee-0000-0000-ac72-000000000001', 'Someone Else') $q$, 'asset_checkouts_one_open');
select tests.expect_error($q$ insert into public.asset_checkouts (org_id, asset_id, project_id, holder_name) values ('aaaaaaaa-0000-0000-ac72-000000000001', 'eeeeeeee-0000-0000-ac72-000000000002', 'bbbbbbbb-0000-0000-ac72-000000000002', 'Sam') $q$, 'another company');
select tests.expect_error($q$ update public.asset_checkouts set holder_name = 'Changed' where id = '66666666-0000-0000-ac72-000000000001' $q$, 'fixed');
reset role;
select tests.expect_error($q$ delete from public.asset_checkouts where id = '66666666-0000-0000-ac72-000000000001' $q$, 'never changed or removed');
set local role authenticated;
update public.asset_checkouts set in_at = now(), condition_in = 'Fine' where id = '66666666-0000-0000-ac72-000000000001';
select tests.expect_error($q$ update public.asset_checkouts set condition_in = 'Changed' where id = '66666666-0000-0000-ac72-000000000001' $q$, 'frozen');
do $$ begin assert (select in_by from public.asset_checkouts where id = '66666666-0000-0000-ac72-000000000001') = '00000000-0000-0000-ac72-000000000001', 'in_by is the caller'; end $$;
update public.assets set active = false, retired_reason = 'Failed test, cut up' where id = 'eeeeeeee-0000-0000-ac72-000000000002';
select tests.expect_error($q$ insert into public.asset_checkouts (org_id, asset_id, holder_name) values ('aaaaaaaa-0000-0000-ac72-000000000001', 'eeeeeeee-0000-0000-ac72-000000000002', 'Sam') $q$, 'retired');
-- The other company sees none of it.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-ac72-000000000006","role":"authenticated"}', true);
do $$ begin
  assert (select count(*) from public.asset_register where org_id = 'aaaaaaaa-0000-0000-ac72-000000000001') = 0, 'another company reads the register';
  assert (select count(*) from public.asset_checkouts) = 0, 'another company reads custody';
end $$;
do $$ begin raise notice 'PASS  7 one open custody, fixed on the way out, frozen once back; a retired asset stays in; the other company sees none'; end $$;

rollback;
