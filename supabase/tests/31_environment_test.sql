-- Environmental management: criteria versioned and frozen, aspects judged against them with history kept,
-- the legal register and an evaluation of compliance that must cover it and discharges its schedule,
-- the Spec 204 / EP Act s. 72 trail on environmental incidents only, monitoring with exceedances acted on,
-- and the labourer reading none of it.
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

-- ---------------------------------------------------------------- aspects and criteria
select tests.expect_error($q$
  insert into public.env_aspects (org_id, activity, aspect, impact, likelihood, consequence)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'Earthworks', 'Dust', 'Nuisance', 4, 3)
$q$, 'significance criteria first');
insert into public.env_significance_criteria (org_id, version, method, threshold) values ('aaaaaaaa-0000-0000-0000-000000000001', 99, 'L x C, 5x5', 12);
insert into public.env_aspects (id, org_id, activity, aspect, impact, likelihood, consequence, controls)
values ('a1000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', ' Earthworks ', 'Dust generation', 'Nuisance to neighbours', 4, 3, 'Water cart'),
       ('a1000000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'Refuelling', 'Fuel spill', 'Soil contamination', 2, 4, 'Bunded refuelling');
do $$ begin
  assert (select version from public.env_significance_criteria where org_id = 'aaaaaaaa-0000-0000-0000-000000000001') = 1, 'criteria not numbered by the database';
  assert (select significant from public.env_aspects where id = 'a1000000-0000-0000-0000-000000000001'), '12 at threshold 12 should be significant';
  assert not (select significant from public.env_aspects where id = 'a1000000-0000-0000-0000-000000000002'), '8 should not be significant';
  assert (select activity from public.env_aspects where id = 'a1000000-0000-0000-0000-000000000001') = 'Earthworks', 'activity not trimmed';
  raise notice 'PASS  aspects are judged against the criteria in force, by the database';
end $$;
update public.env_significance_criteria set threshold = 5;
delete from public.env_significance_criteria;
do $$ begin
  assert (select threshold from public.env_significance_criteria where version = 1) = 12, 'criteria were changed';
end $$;
insert into public.env_significance_criteria (org_id, version, method, threshold) values ('aaaaaaaa-0000-0000-0000-000000000001', 1, 'Stricter', 8);
update public.env_aspects set controls = 'Bunded refuelling, spill kit' where id = 'a1000000-0000-0000-0000-000000000002';
do $$ begin
  assert (select significant from public.env_aspects where id = 'a1000000-0000-0000-0000-000000000002'), 'reassessed against version 2 at 8 it should be significant';
  assert (select count(*) from public.env_register_history where row_id = 'a1000000-0000-0000-0000-000000000002') = 1, 'the change left no history';
  assert (select was ->> 'controls' from public.env_register_history where row_id = 'a1000000-0000-0000-0000-000000000002') = 'Bunded refuelling', 'history does not hold the row as it was';
  raise notice 'PASS  criteria are versioned and frozen; a change to an aspect keeps what it was';
end $$;
insert into public.project_env_aspects (project_id, aspect_id) values ('bbbbbbbb-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001');

-- ---------------------------------------------------------------- legal register and evaluation
insert into public.env_legal_obligations (id, org_id, project_id, title, source_type, reference, requirement, how_applies) values
  ('b1000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', null, 'Duty to notify of discharge', 'legislation', 'EP Act 1986 (WA) s. 72', 'Written notice to DWER', 'Any spill from plant on our jobs'),
  ('b1000000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'Environmental incident reporting', 'contract', 'MRWA Spec 204 cl. 204.28', 'Report in 24 h / 3 days', 'Northern contract');
insert into public.env_obligation_aspects (obligation_id, aspect_id) values ('b1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002');
insert into public.obligations (id, org_id, project_id, kind, title, interval_months, first_due_on) values
  ('c0000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'compliance_evaluation', 'Evaluation', 12, current_date - 3);
insert into public.compliance_evaluations (id, org_id, project_id, obligation_id, evaluated_on, evaluator_name)
values ('d0000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', current_date - 1, 'R. Singh');
select tests.expect_error($q$
  insert into public.compliance_evaluation_results (evaluation_id, legal_obligation_id, result) values ('d0000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 'compliant')
$q$, 'compliance_result_evidence');
select tests.expect_error($q$
  insert into public.compliance_evaluation_results (evaluation_id, legal_obligation_id, result, evidence) values ('d0000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 'non_compliant', 'No notice')
$q$, 'compliance_result_action');
insert into public.compliance_evaluation_results (id, evaluation_id, legal_obligation_id, result, evidence, action, owner_name, due_on)
values ('e0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 'non_compliant', 'Spill 3/9 phoned only', 'Send written notice; brief supervisors', 'Matt', current_date + 7);
select tests.expect_error($q$
  update public.compliance_evaluations set status = 'issued', summary = 'One gap' where id = 'd0000000-0000-0000-0000-000000000001'
$q$, '1 without one');
insert into public.compliance_evaluation_results (evaluation_id, legal_obligation_id, result, evidence)
values ('d0000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000002', 'compliant', 'INC-004 reported in 6 h');
select tests.expect_error($q$
  update public.compliance_evaluations set status = 'issued' where id = 'd0000000-0000-0000-0000-000000000001'
$q$, 'summary');
update public.compliance_evaluations set status = 'issued', summary = 'One non-compliance, action set' where id = 'd0000000-0000-0000-0000-000000000001';
do $$ begin
  assert (select count(*) from public.obligation_completions where obligation_id = 'c0000000-0000-0000-0000-000000000001' and evidence_ref = 'compliance:d0000000-0000-0000-0000-000000000001') = 1,
    'issuing the evaluation did not discharge its schedule';
  raise notice 'PASS  an evaluation covers every obligation, evidences each, acts on a gap, and discharges its schedule';
end $$;
select tests.expect_error($q$
  update public.compliance_evaluation_results set evidence = 'Changed' where id = 'e0000000-0000-0000-0000-000000000001'
$q$, 'only its action is marked done');
update public.compliance_evaluation_results set done_at = '2000-01-01', done_note = 'Notice sent' where id = 'e0000000-0000-0000-0000-000000000001';
do $$ begin
  assert (select done_at from public.compliance_evaluation_results where id = 'e0000000-0000-0000-0000-000000000001') > now() - interval '1 minute', 'done not stamped by the database';
  raise notice 'PASS  an issued evaluation is frozen but for marking its action done, stamped';
end $$;

-- ---------------------------------------------------------------- environmental incident trail
reset role;
insert into public.incidents (id, project_id, kind, occurred_at, description, reported_by) values
  ('f0000000-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'environmental', now() - interval '3 hours', 'Hydraulic hose burst, oil to stormwater pit', '11111111-1111-1111-1111-111111111111'),
  ('f0000000-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000001', 'hazard', now() - interval '3 hours', 'Loose edge', '11111111-1111-1111-1111-111111111111');
set local role authenticated;
select tests.expect_error($q$
  insert into public.incident_environment_events (incident_id, kind, happened_at, severity, serious) values ('f0000000-0000-0000-0000-000000000002', 'assessed', now(), 'minor', false)
$q$, 'Only an environmental incident');
select tests.expect_error($q$
  insert into public.incident_environment_events (incident_id, kind, happened_at) values ('f0000000-0000-0000-0000-000000000001', 'assessed', now())
$q$, 'env_event_assessed');
select tests.expect_error($q$
  insert into public.incident_environment_events (incident_id, kind, happened_at) values ('f0000000-0000-0000-0000-000000000001', 'dwer_notifiable', now())
$q$, 'env_event_dwer_trigger');
insert into public.incident_environment_events (id, incident_id, kind, happened_at, severity, serious) values
  ('f1000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001', 'assessed', now() - interval '2 hours', 'moderate', true);
insert into public.incident_environment_events (incident_id, kind, happened_at, dwer_trigger, person_name) values
  ('f0000000-0000-0000-0000-000000000001', 'dwer_notifiable', now() - interval '2 hours', 'emergency_accident_malfunction', 'Matt');
update public.incident_environment_events set severity = 'minor' where id = 'f1000000-0000-0000-0000-000000000001';
do $$ begin
  assert (select severity from public.incident_environment_events where id = 'f1000000-0000-0000-0000-000000000001') = 'moderate', 'an assessment was changed';
  raise notice 'PASS  the Spec 204 / s. 72 trail is for environmental incidents only, each step complete and frozen';
end $$;

-- ---------------------------------------------------------------- monitoring
reset role;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
set local role authenticated;
select tests.expect_error($q$
  insert into public.env_monitoring_records (project_id, monitored_on, kind, location, parameter, value, unit, limit_value, outcome)
  values ('bbbbbbbb-0000-0000-0000-000000000001', current_date, 'noise', 'Boundary east', 'LAeq 15 min', 72, 'dB(A)', 65, 'within_limit')
$q$, 'outside its limit');
insert into public.env_monitoring_records (id, project_id, monitored_on, kind, location, parameter, value, unit, limit_value, outcome, action_taken) values
  ('91000000-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', current_date, 'noise', 'Boundary east', 'LAeq 15 min', 72, 'dB(A)', 65, 'within_limit', 'Rock breaker stood down, resumed after 9 am'),
  ('91000000-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000001', current_date, 'dust', 'Haul road', 'Visible dust', null, null, null, 'observation', null);
select tests.expect_error($q$
  insert into public.env_monitoring_records (project_id, monitored_on, kind, location, parameter, outcome) values ('bbbbbbbb-0000-0000-0000-000000000001', current_date + 2, 'dust', 'x', 'y', 'observation')
$q$, 'once it is done');
do $$ begin
  assert (select outcome from public.env_monitoring_records where id = '91000000-0000-0000-0000-000000000001') = 'exceedance', 'the database did not judge the reading against its limit';
  raise notice 'PASS  a leading hand records monitoring; a reading over its limit is an exceedance, acted on';
end $$;
select tests.expect_error($q$
  insert into public.env_aspects (org_id, activity, aspect, impact, likelihood, consequence) values ('aaaaaaaa-0000-0000-0000-000000000001', 'x', 'y', 'z', 1, 1)
$q$, 'row-level security');

-- ---------------------------------------------------------------- README R78 (second-agent review)
reset role;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;
-- A company-wide evaluation covers company-wide obligations only: this job's contract obligation is not asked of it.
insert into public.compliance_evaluations (id, org_id, project_id, evaluated_on, evaluator_name)
values ('d0000000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', null, current_date, 'Company evaluator');
insert into public.compliance_evaluation_results (id, evaluation_id, legal_obligation_id, result, evidence)
values ('e0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000001', 'compliant', 'Checked');
select tests.expect_error($q$
  insert into public.compliance_evaluation_results (evaluation_id, legal_obligation_id, result, evidence) values ('d0000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000002', 'compliant', 'x')
$q$, 'not in this evaluation');
-- Done on a draft is stamped once; a later update does not move it.
update public.compliance_evaluation_results set done_at = now(), done_note = 'x' where id = 'e0000000-0000-0000-0000-000000000002';
update public.compliance_evaluation_results set done_at = '2000-01-01' where id = 'e0000000-0000-0000-0000-000000000002';
update public.compliance_evaluations set status = 'issued', summary = 'Company compliant' where id = 'd0000000-0000-0000-0000-000000000002';
do $$ begin
  assert (select status from public.compliance_evaluations where id = 'd0000000-0000-0000-0000-000000000002') = 'issued', 'a company-wide evaluation could not be issued without a job''s obligations';
  assert (select done_at from public.compliance_evaluation_results where id = 'e0000000-0000-0000-0000-000000000002') > now() - interval '1 minute', 'a done date was moved on a draft';
  raise notice 'PASS  a company-wide evaluation covers company-wide obligations; a done date is not moved';
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
set local role authenticated;
-- A minimum limit: pH 4.8 against a minimum of 6.5 is an exceedance and needs its action.
select tests.expect_error($q$
  insert into public.env_monitoring_records (project_id, monitored_on, kind, location, parameter, value, unit, limit_value, limit_kind, outcome)
  values ('bbbbbbbb-0000-0000-0000-000000000001', current_date, 'water', 'Sediment basin', 'pH', 4.8, 'pH', 6.5, 'minimum', 'within_limit')
$q$, 'outside its limit');
insert into public.env_monitoring_records (id, project_id, monitored_on, kind, location, parameter, value, unit, limit_value, limit_kind, outcome, action_taken)
values ('91000000-0000-0000-0000-000000000003', 'bbbbbbbb-0000-0000-0000-000000000001', current_date, 'water', 'Sediment basin', 'pH', 4.8, 'pH', 6.5, 'minimum', 'within_limit', 'Dosed with lime, retested');
do $$ begin
  assert (select outcome from public.env_monitoring_records where id = '91000000-0000-0000-0000-000000000003') = 'exceedance', 'a reading below its minimum was not an exceedance';
  raise notice 'PASS  a reading below a minimum limit is an exceedance';
end $$;
-- Frozen for everyone, the service role included: history and monitoring cannot be edited or removed.
reset role;
select set_config('request.jwt.claims', '', true);
select tests.expect_error($q$ update public.env_register_history set was = '{}'::jsonb $q$, 'never changed');
select tests.expect_error($q$ delete from public.env_monitoring_records where id = '91000000-0000-0000-0000-000000000003' $q$, 'never changed');
select tests.expect_error($q$ update public.env_significance_criteria set threshold = 1 $q$, 'never changed');
do $$ begin raise notice 'PASS  history, monitoring and criteria are frozen for every role, the service role included'; end $$;

-- ---------------------------------------------------------------- the labourer reads none of it
reset role;
select set_config('request.jwt.claims', '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  assert (select count(*) from public.env_aspects) = 0, 'a labourer read the aspects';
  assert (select count(*) from public.env_legal_obligations) = 0, 'a labourer read the legal register';
  assert (select count(*) from public.compliance_evaluations) = 0, 'a labourer read an evaluation';
  assert (select count(*) from public.incident_environment_events) = 0, 'a labourer read the trail';
  assert (select count(*) from public.env_monitoring_records) = 0, 'a labourer read monitoring';
  raise notice 'PASS  the labourer reads none of it';
end $$;

reset role;
select set_config('request.jwt.claims', '', true);
do $$ begin raise notice 'ALL ENVIRONMENT TESTS PASSED'; end $$;
rollback;
