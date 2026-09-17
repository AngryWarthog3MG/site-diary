-- Quality: ITPs issued and revised, lots worked to them, calibrated checks, hold points, and non-conformance.
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

select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;

-- ---------------------------------------------------------------- ITPs
insert into public.itps (id, project_id, code, title, revision) values
  ('c1000000-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'ITP-01', 'Subgrade and basecourse', 99);
select tests.expect_error($q$
  update public.itps set status = 'issued' where id = 'c1000000-0000-0000-0000-000000000001'
$q$, 'at least one inspection or test point');
insert into public.itp_points (id, itp_id, seq, activity, inspection_test, acceptance_criteria, method, frequency, responsible, point_type, uses_calibrated_equipment) values
  ('d1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 1, 'Subgrade', 'Compaction', '≥ 98% MDD', 'Nuclear density', '1 per 500 m²', 'Leading hand', 'hold', true),
  ('d1000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000001', 2, 'Basecourse', 'Level', '± 10 mm', 'Survey', 'Every 10 m', 'Surveyor', 'witness', false);
update public.itps set status = 'issued' where id = 'c1000000-0000-0000-0000-000000000001';
do $$ begin
  assert (select revision from public.itps where id = 'c1000000-0000-0000-0000-000000000001') = 1, 'the first revision was not numbered 1';
  assert (select issued_by from public.itps where id = 'c1000000-0000-0000-0000-000000000001') = '11111111-1111-1111-1111-111111111111', 'issuer not stamped';
end $$;
select tests.expect_error($q$
  insert into public.itp_points (itp_id, seq, activity, inspection_test, acceptance_criteria, frequency, responsible, point_type)
  values ('c1000000-0000-0000-0000-000000000001', 3, 'x', 'x', 'x', 'x', 'x', 'record')
$q$, 'do not change');
select tests.expect_error($q$
  update public.itps set title = 'Something else' where id = 'c1000000-0000-0000-0000-000000000001'
$q$, 'does not change');
update public.itps set submitted_to_principal_on = current_date, principal_review_note = 'Reviewed, no comments' where id = 'c1000000-0000-0000-0000-000000000001';
select tests.expect_error($q$
  delete from public.itps where id = 'c1000000-0000-0000-0000-000000000001'
$q$, 'never deleted');
do $$ begin raise notice 'PASS  an ITP needs points to issue, then its points and title are frozen and only its review is recorded'; end $$;

-- A revision supersedes on issue.
insert into public.itps (id, project_id, code, title, supersedes_id) values
  ('c1000000-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000001', 'itp-01', 'Subgrade and basecourse (rev)', 'c1000000-0000-0000-0000-000000000001');
insert into public.itp_points (id, itp_id, seq, activity, inspection_test, acceptance_criteria, method, frequency, responsible, point_type, uses_calibrated_equipment) values
  ('d2000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000002', 1, 'Subgrade', 'Compaction', '≥ 98% MDD', 'Nuclear density', '1 per 500 m²', 'Leading hand', 'hold', true),
  ('d2000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000002', 2, 'Basecourse', 'Level', '± 10 mm', 'Survey', 'Every 10 m', 'Surveyor', 'witness', false);
do $$ begin
  assert (select revision from public.itps where id = 'c1000000-0000-0000-0000-000000000002') = 2, 'the revision was not numbered 2';
end $$;
-- A lot cannot be worked to a draft.
select tests.expect_error($q$
  insert into public.lots (project_id, itp_id, description, location) values ('bbbbbbbb-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000002', 'x', 'x')
$q$, 'issued ITP');
update public.itps set status = 'issued' where id = 'c1000000-0000-0000-0000-000000000002';
do $$ begin
  assert (select status from public.itps where id = 'c1000000-0000-0000-0000-000000000001') = 'superseded', 'revision 1 was not superseded';
  raise notice 'PASS  a revision is numbered 2 and supersedes revision 1 when issued';
end $$;
select tests.expect_error($q$
  insert into public.lots (project_id, itp_id, description, location) values ('bbbbbbbb-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'x', 'x')
$q$, 'issued ITP');

-- ---------------------------------------------------------------- calibration
insert into public.measuring_equipment (id, org_id, name, serial_no) values
  ('e1000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Nuclear density gauge', 'NDG-7'),
  ('e1000000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'Old gauge', 'NDG-1');
insert into public.equipment_calibrations (equipment_id, calibrated_on, due_on, certificate_no, calibrated_by) values
  ('e1000000-0000-0000-0000-000000000001', current_date - 30, current_date + 335, 'NATA-12345', 'Accredited lab'),
  ('e1000000-0000-0000-0000-000000000002', current_date - 400, current_date - 35, 'NATA-00001', 'Accredited lab');
select tests.expect_error($q$
  insert into public.equipment_calibrations (equipment_id, calibrated_on, due_on, certificate_no) values ('e1000000-0000-0000-0000-000000000001', app.perth_today() + 1, app.perth_today() + 100, 'X')
$q$, 'in the future');

-- ---------------------------------------------------------------- lot 1: the good path
reset role;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
set local role authenticated;
insert into public.lots (id, project_id, itp_id, description, location) values
  ('f1000000-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000002', 'Car park subgrade, bay A', 'CH 0–50');
select tests.expect_error($q$
  insert into public.lot_checks (lot_id, itp_point_id, result, checked_on) values ('f1000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000001', 'conforms', current_date)
$q$, 'say which');
select tests.expect_error($q$
  insert into public.lot_checks (lot_id, itp_point_id, result, checked_on, equipment_id) values ('f1000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000001', 'conforms', current_date, 'e1000000-0000-0000-0000-000000000002')
$q$, 'not in calibration');
select tests.expect_error($q$
  insert into public.lot_checks (lot_id, itp_point_id, result, checked_on) values ('f1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000002', 'conforms', current_date)
$q$, 'own ITP');
select tests.expect_error($q$
  insert into public.hold_point_releases (lot_id, itp_point_id, released_at, released_by_name) values ('f1000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000001', now(), 'Superintendent')
$q$, 'once its check conforms');
insert into public.lot_checks (lot_id, itp_point_id, result, measured, test_reference, checked_on, equipment_id)
values ('f1000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000001', 'conforms', '99.1% MDD', 'LAB-2291', current_date, 'e1000000-0000-0000-0000-000000000001');
select tests.expect_error($q$
  update public.lots set status = 'conforming' where id = 'f1000000-0000-0000-0000-000000000001'
$q$, 'is not released');
insert into public.hold_point_releases (lot_id, itp_point_id, released_at, released_by_name, authority)
values ('f1000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000001', now(), 'J. Smith', 'Superintendent''s representative');
select tests.expect_error($q$
  update public.lots set status = 'conforming' where id = 'f1000000-0000-0000-0000-000000000001'
$q$, 'has no result');
select tests.expect_error($q$
  insert into public.hold_point_releases (lot_id, itp_point_id, released_at, released_by_name) values ('f1000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000002', now(), 'X')
$q$, 'only a hold point');
insert into public.lot_checks (lot_id, itp_point_id, result, measured, checked_on) values ('f1000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000002', 'conforms', '+4 mm', current_date);
update public.lots set status = 'conforming', close_note = 'All points conform' where id = 'f1000000-0000-0000-0000-000000000001';
do $$ begin
  assert (select seq from public.lots where id = 'f1000000-0000-0000-0000-000000000001') = 1, 'lot not numbered 1';
  assert (select closed_by from public.lots where id = 'f1000000-0000-0000-0000-000000000001') = '22222222-2222-2222-2222-222222222222', 'closer not stamped';
end $$;
select tests.expect_error($q$
  insert into public.lot_checks (lot_id, itp_point_id, result, checked_on) values ('f1000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000002', 'conforms', current_date)
$q$, 'closed');
do $$ begin raise notice 'PASS  calibrated equipment is enforced, a hold point is released after it conforms, and a lot closes only when every point conforms and every hold is released'; end $$;

-- ---------------------------------------------------------------- lot 2: failure, NCR, repair, release, close
insert into public.lots (id, project_id, itp_id, description, location) values
  ('f1000000-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000002', 'Car park subgrade, bay B', 'CH 50–100');
insert into public.lot_checks (lot_id, itp_point_id, result, measured, test_reference, checked_on, equipment_id)
values ('f1000000-0000-0000-0000-000000000002', 'd2000000-0000-0000-0000-000000000001', 'does_not_conform', '94.0% MDD', 'LAB-2292', current_date, 'e1000000-0000-0000-0000-000000000001');
do $$ begin
  assert (select status from public.lots where id = 'f1000000-0000-0000-0000-000000000002') = 'nonconforming', 'a failed check did not put the lot on hold';
end $$;
-- cl. 201.06.04: no further testing before an NCR is raised...
select tests.expect_error($q$
  insert into public.lot_checks (lot_id, itp_point_id, result, checked_on, equipment_id) values ('f1000000-0000-0000-0000-000000000002', 'd2000000-0000-0000-0000-000000000001', 'conforms', current_date, 'e1000000-0000-0000-0000-000000000001')
$q$, 'no further testing');
insert into public.ncrs (id, project_id, lot_id, itp_point_id, detected_at, detected_by_name, observation)
values ('a9000000-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000002', 'd2000000-0000-0000-0000-000000000001',
        now() - interval '1 hour', 'Lee Hand', 'Compaction 94% against 98% required');
-- ...nor while it is open.
select tests.expect_error($q$
  insert into public.lot_checks (lot_id, itp_point_id, result, checked_on, equipment_id) values ('f1000000-0000-0000-0000-000000000002', 'd2000000-0000-0000-0000-000000000001', 'conforms', current_date, 'e1000000-0000-0000-0000-000000000001')
$q$, 'no further testing');
-- A leading hand raises an NCR but does not approve it.
update public.ncrs set root_cause = 'x', corrective_action = 'y', disposition = 'repair', approved_by_name = 'Me', status = 'approved' where id = 'a9000000-0000-0000-0000-000000000001';
do $$ begin
  assert (select status from public.ncrs where id = 'a9000000-0000-0000-0000-000000000001') = 'open', 'a leading hand approved an NCR';
  assert (select seq from public.ncrs where id = 'a9000000-0000-0000-0000-000000000001') = 1, 'NCR not numbered 1';
end $$;

reset role;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;
select tests.expect_error($q$
  update public.ncrs set status = 'approved', approved_by_name = 'Superintendent' where id = 'a9000000-0000-0000-0000-000000000001'
$q$, 'root cause');
select tests.expect_error($q$
  update public.ncrs set observation = 'Softer words' where id = 'a9000000-0000-0000-0000-000000000001'
$q$, 'does not change');
select tests.expect_error($q$
  update public.ncrs set status = 'closed' where id = 'a9000000-0000-0000-0000-000000000001'
$q$, 'approved before');
update public.ncrs set reported_to_principal_at = now(), root_cause = 'Moisture too high after rain',
  corrective_action = 'Rip, dry back and recompact bay B', preventive_action = 'Check moisture before compaction after rain',
  disposition = 'repair', approved_by_name = 'J. Smith (Superintendent)', status = 'approved'
  where id = 'a9000000-0000-0000-0000-000000000001';
select tests.expect_error($q$
  update public.ncrs set reported_to_principal_at = now() + interval '1 minute' where id = 'a9000000-0000-0000-0000-000000000001'
$q$, 'does not change');

-- With the corrective action approved, the repaired bay is re-tested.
reset role;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
set local role authenticated;
insert into public.lot_checks (lot_id, itp_point_id, result, measured, test_reference, checked_on, equipment_id)
values ('f1000000-0000-0000-0000-000000000002', 'd2000000-0000-0000-0000-000000000001', 'conforms', '98.6% MDD', 'LAB-2301', current_date, 'e1000000-0000-0000-0000-000000000001');
select tests.expect_error($q$
  update public.lots set status = 'open' where id = 'f1000000-0000-0000-0000-000000000002'
$q$, 'not by reopening it');

reset role;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;
update public.ncrs set status = 'closed', close_note = 'Re-test LAB-2301 conforms' where id = 'a9000000-0000-0000-0000-000000000001';
do $$ begin
  assert (select status from public.lots where id = 'f1000000-0000-0000-0000-000000000002') = 'open', 'closing the NCR did not lift the hold';
  raise notice 'PASS  a failed check holds the lot; no testing until an NCR is approved; closing the NCR lifts the hold';
end $$;
select tests.expect_error($q$
  update public.ncrs set close_note = 'edited' where id = 'a9000000-0000-0000-0000-000000000001'
$q$, 'frozen');

reset role;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
set local role authenticated;
insert into public.hold_point_releases (lot_id, itp_point_id, released_at, released_by_name) values ('f1000000-0000-0000-0000-000000000002', 'd2000000-0000-0000-0000-000000000001', now(), 'J. Smith');
insert into public.lot_checks (lot_id, itp_point_id, result, checked_on) values ('f1000000-0000-0000-0000-000000000002', 'd2000000-0000-0000-0000-000000000002', 'conforms', current_date);
update public.lots set status = 'conforming' where id = 'f1000000-0000-0000-0000-000000000002';
do $$ begin
  assert (select status from public.lots where id = 'f1000000-0000-0000-0000-000000000002') = 'conforming', 'the repaired lot did not close';
  raise notice 'PASS  the repaired lot is released and closes as conforming';
end $$;

-- ---------------------------------------------------------------- lot 3: rework into a re-numbered lot
insert into public.lots (id, project_id, itp_id, description, location) values
  ('f1000000-0000-0000-0000-000000000003', 'bbbbbbbb-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000002', 'Kerb line', 'CH 100–150');
insert into public.ncrs (id, project_id, lot_id, detected_at, detected_by_name, observation)
values ('a9000000-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000003', now(), 'Lee Hand', 'Kerb poured to the wrong line');
reset role;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;
update public.ncrs set root_cause = 'Set-out from superseded drawing', corrective_action = 'Break out and repour to rev C', disposition = 'rework',
  approved_by_name = 'J. Smith', status = 'approved' where id = 'a9000000-0000-0000-0000-000000000002';
insert into public.lots (id, project_id, itp_id, description, location, replaces_lot_id) values
  ('f1000000-0000-0000-0000-000000000004', 'bbbbbbbb-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000002', 'Kerb line — rework', 'CH 100–150', 'f1000000-0000-0000-0000-000000000003');
update public.ncrs set status = 'closed' where id = 'a9000000-0000-0000-0000-000000000002';
do $$ begin
  assert (select status from public.lots where id = 'f1000000-0000-0000-0000-000000000003') = 'replaced', 'the original lot was not marked replaced';
  assert (select seq from public.lots where id = 'f1000000-0000-0000-0000-000000000004') = 4, 'the rework lot was not re-numbered';
  raise notice 'PASS  rework opens a re-numbered lot that replaces the original, which stays replaced when its NCR closes';
end $$;
select tests.expect_error($q$
  insert into public.lots (project_id, itp_id, description, location, replaces_lot_id) values ('bbbbbbbb-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000002', 'x', 'x', 'f1000000-0000-0000-0000-000000000001')
$q$, 'only a non-conforming lot');

-- ---------------------------------------------------------------- the labourer reads none of it
reset role;
select set_config('request.jwt.claims', '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  assert (select count(*) from public.itps) = 0 and (select count(*) from public.lots) = 0 and (select count(*) from public.ncrs) = 0
     and (select count(*) from public.lot_checks) = 0 and (select count(*) from public.measuring_equipment) = 0, 'a labourer read quality records';
  raise notice 'PASS  a labourer reads no quality records';
end $$;

reset role;
select set_config('request.jwt.claims', '', true);
do $$ begin raise notice 'ALL QUALITY TESTS PASSED'; end $$;
rollback;
