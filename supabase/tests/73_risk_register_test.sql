-- The risk register (README R187): the level is the matrix's when the likelihood and consequence are given, and the
-- company's matrix when it sets one — a rating already made keeps its level; a job's profile is the job's to assess,
-- the company's is the office's; risks are numbered per company; a planned control is an action in the register and
-- closing it there puts it in place; existing controls are in place from the start; withdrawn needs a reason and
-- freezes; a closed risk and an archived profile are frozen; reviews count forward; the labourer reads none of it.
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
  ('00000000-0000-0000-ac73-000000000001', 'sup73@example.com'),
  ('00000000-0000-0000-ac73-000000000002', 'lh73@example.com'),
  ('00000000-0000-0000-ac73-000000000003', 'lab73@example.com'),
  ('00000000-0000-0000-ac73-000000000005', 'pm73@example.com'),
  ('00000000-0000-0000-ac73-000000000006', 'sup73b@example.com');
insert into public.profiles (id, email, full_name) values
  ('00000000-0000-0000-ac73-000000000001', 'sup73@example.com', 'Sue Pervisor'),
  ('00000000-0000-0000-ac73-000000000002', 'lh73@example.com', 'Lee Hand'),
  ('00000000-0000-0000-ac73-000000000003', 'lab73@example.com', 'Sam Labourer'),
  ('00000000-0000-0000-ac73-000000000005', 'pm73@example.com', 'Pat Manager'),
  ('00000000-0000-0000-ac73-000000000006', 'sup73b@example.com', 'Other Company')
  on conflict (id) do nothing;
insert into public.organisations (id, name, code) values
  ('aaaaaaaa-0000-0000-ac73-000000000001', 'Kingsbridge Civil', 'KB73'),
  ('aaaaaaaa-0000-0000-ac73-000000000002', 'Other Civil', 'OC73');
insert into public.projects (id, org_id, name, code) values
  ('bbbbbbbb-0000-0000-ac73-000000000001', 'aaaaaaaa-0000-0000-ac73-000000000001', 'Northern', 'C073'),
  ('bbbbbbbb-0000-0000-ac73-000000000003', 'aaaaaaaa-0000-0000-ac73-000000000001', 'Southern', 'C074'),
  ('bbbbbbbb-0000-0000-ac73-000000000002', 'aaaaaaaa-0000-0000-ac73-000000000002', 'Elsewhere', 'X073');
insert into public.project_members (project_id, user_id, role) values
  ('bbbbbbbb-0000-0000-ac73-000000000001', '00000000-0000-0000-ac73-000000000001', 'supervisor'),
  ('bbbbbbbb-0000-0000-ac73-000000000001', '00000000-0000-0000-ac73-000000000002', 'leading_hand'),
  ('bbbbbbbb-0000-0000-ac73-000000000001', '00000000-0000-0000-ac73-000000000003', 'labourer'),
  ('bbbbbbbb-0000-0000-ac73-000000000001', '00000000-0000-0000-ac73-000000000005', 'pm'),
  ('bbbbbbbb-0000-0000-ac73-000000000002', '00000000-0000-0000-ac73-000000000006', 'supervisor');

-- 1. The matrix: the built-in is the SWMS's; the office sets the company's own; a malformed one is refused; the
--    supervisor cannot set it.
do $$ begin
  assert app.risk_level('aaaaaaaa-0000-0000-ac73-000000000001', 'likely', 'catastrophic') = 'extreme', 'built-in likely × catastrophic';
  assert app.risk_level('aaaaaaaa-0000-0000-ac73-000000000001', 'rare', 'insignificant') = 'low', 'built-in rare × insignificant';
  assert app.risk_level('aaaaaaaa-0000-0000-ac73-000000000001', 'possible', 'moderate') = 'high', 'built-in possible × moderate';
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-ac73-000000000001","role":"authenticated"}', true);
set local role authenticated;
select tests.expect_error($q$ insert into public.org_risk_matrices (org_id) values ('aaaaaaaa-0000-0000-ac73-000000000001') $q$, 'row-level security');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-ac73-000000000005","role":"authenticated"}', true);
select tests.expect_error($q$ insert into public.org_risk_matrices (org_id, cells) values ('aaaaaaaa-0000-0000-ac73-000000000001', '[["low"]]') $q$, 'five rows');
select tests.expect_error($q$ insert into public.org_risk_matrices (org_id, cells) values ('aaaaaaaa-0000-0000-ac73-000000000001', '[["low","low","low","low","severe"],["low","low","low","low","low"],["low","low","low","low","low"],["low","low","low","low","low"],["low","low","low","low","low"]]') $q$, 'low, medium, high or extreme');
reset role;
do $$ begin raise notice 'PASS  1 the matrix is the SWMS''s until the office sets one, and a bad one is refused'; end $$;

-- 2. Profiles: a job's by the job's supervisor; the company's refused to them and allowed to the PM; another
--    company's job refused; status forward only; archive needs a reason and freezes; never deleted.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-ac73-000000000001","role":"authenticated"}', true);
set local role authenticated;
insert into public.risk_profiles (id, org_id, scope, project_id, name, originator_name, assessor_name, owner_name, review_interval_months) values
  ('cccccccc-0000-0000-ac73-000000000001', 'aaaaaaaa-0000-0000-ac73-000000000001', 'project', 'bbbbbbbb-0000-0000-ac73-000000000001', '  Trenching, Stage 2 ', 'Sue', 'Sue', 'Pat', 6);
select tests.expect_error($q$ insert into public.risk_profiles (org_id, scope, name) values ('aaaaaaaa-0000-0000-ac73-000000000001', 'company', 'Company-wide') $q$, 'row-level security');
select tests.expect_error($q$ insert into public.risk_profiles (org_id, scope, project_id, name) values ('aaaaaaaa-0000-0000-ac73-000000000001', 'project', 'bbbbbbbb-0000-0000-ac73-000000000003', 'Other job') $q$, 'row-level security');
do $$ declare r record; begin
  select * into r from public.risk_profiles where id = 'cccccccc-0000-0000-ac73-000000000001';
  assert r.name = 'Trenching, Stage 2' and r.status = 'draft' and r.created_by = '00000000-0000-0000-ac73-000000000001', 'the profile is born a tidy draft by its author: ' || row_to_json(r)::text;
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-ac73-000000000005","role":"authenticated"}', true);
insert into public.risk_profiles (id, org_id, scope, name) values ('cccccccc-0000-0000-ac73-000000000002', 'aaaaaaaa-0000-0000-ac73-000000000001', 'company', 'Company-wide');
select tests.expect_error($q$ insert into public.risk_profiles (org_id, scope, name) values ('aaaaaaaa-0000-0000-ac73-000000000001', 'project', 'No job named') $q$, 'risk_profiles_scope_whole');
select tests.expect_error($q$ insert into public.risk_profiles (org_id, scope, project_id, name) values ('aaaaaaaa-0000-0000-ac73-000000000001', 'project', 'bbbbbbbb-0000-0000-ac73-000000000002', 'Their job') $q$, 'another company');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-ac73-000000000001","role":"authenticated"}', true);
select tests.expect_error($q$ update public.risk_profiles set status = 'archived' where id = 'cccccccc-0000-0000-ac73-000000000001' $q$, 'say why');
select tests.expect_error($q$ update public.risk_profiles set scope = 'company', project_id = null where id = 'cccccccc-0000-0000-ac73-000000000001' $q$, 'keeps its company and its scope');
update public.risk_profiles set status = 'current' where id = 'cccccccc-0000-0000-ac73-000000000001';
select tests.expect_error($q$ update public.risk_profiles set status = 'draft' where id = 'cccccccc-0000-0000-ac73-000000000001' $q$, 'never back');
do $$ begin assert (select made_current_at from public.risk_profiles where id = 'cccccccc-0000-0000-ac73-000000000001') is not null, 'made_current_at stamped'; end $$;
reset role;
select tests.expect_error($q$ delete from public.risk_profiles where id = 'cccccccc-0000-0000-ac73-000000000001' $q$, 'never deleted');
do $$ begin raise notice 'PASS  2 a job''s profile is the job''s, the company''s is the office''s; forward only; never deleted'; end $$;

-- 3. Risks: numbered per company; the level computed from the pair on the company's matrix, taken as typed when only
--    a level is given; half a pair refused; assignee must be on the job; a SWMS from another job refused.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-ac73-000000000001","role":"authenticated"}', true);
set local role authenticated;
insert into public.risks (id, org_id, profile_id, task, step, hazard, hazard_type, unwanted_event, inherent_likelihood, inherent_consequence, inherent_level, residual_likelihood, residual_consequence, critical, owner_name, assigned_to) values
  ('dddddddd-0000-0000-ac73-000000000001', 'aaaaaaaa-0000-0000-ac73-000000000001', 'cccccccc-0000-0000-ac73-000000000001', 'Trenching', 'Open the trench', 'Collapse', 'excavation', 'Worker buried', 'likely', 'catastrophic', 'low', 'unlikely', 'major', true, 'Sue', '00000000-0000-0000-ac73-000000000005');
insert into public.risks (id, org_id, profile_id, task, hazard, inherent_level) values
  ('dddddddd-0000-0000-ac73-000000000002', 'aaaaaaaa-0000-0000-ac73-000000000001', 'cccccccc-0000-0000-ac73-000000000001', 'Trenching', 'Services strike', 'high');
do $$ declare r record; begin
  select * into r from public.risks where id = 'dddddddd-0000-0000-ac73-000000000001';
  assert r.seq = 1 and r.inherent_level = 'extreme' and r.residual_level = 'high' and r.potential_level is null and r.status = 'open', 'the matrix rates the pair, the typed level is ignored: ' || row_to_json(r)::text;
  select * into r from public.risks where id = 'dddddddd-0000-0000-ac73-000000000002';
  assert r.seq = 2 and r.inherent_level = 'high' and r.inherent_likelihood is null, 'a level alone stands: ' || row_to_json(r)::text;
end $$;
select tests.expect_error($q$ insert into public.risks (org_id, profile_id, task, hazard, inherent_level, residual_likelihood) values ('aaaaaaaa-0000-0000-ac73-000000000001', 'cccccccc-0000-0000-ac73-000000000001', 'T', 'H', 'low', 'rare') $q$, 'both its likelihood and its consequence');
select tests.expect_error($q$ insert into public.risks (org_id, profile_id, task, hazard, inherent_likelihood, inherent_level) values ('aaaaaaaa-0000-0000-ac73-000000000001', 'cccccccc-0000-0000-ac73-000000000001', 'T', 'H', 'rare', 'low') $q$, 'both its likelihood and its consequence');
select tests.expect_error($q$ insert into public.risks (org_id, profile_id, task, hazard, inherent_level, assigned_to) values ('aaaaaaaa-0000-0000-ac73-000000000001', 'cccccccc-0000-0000-ac73-000000000001', 'T', 'H', 'low', '00000000-0000-0000-ac73-000000000006') $q$, 'someone on the job');
select tests.expect_error($q$ insert into public.risks (org_id, profile_id, task, hazard, inherent_level) values ('aaaaaaaa-0000-0000-ac73-000000000001', 'cccccccc-0000-0000-ac73-000000000002', 'T', 'H', 'low') $q$, 'row-level security');
-- The company's own matrix, set by the office, rates from now on; the risk already rated keeps its level.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-ac73-000000000005","role":"authenticated"}', true);
insert into public.org_risk_matrices (org_id, cells, note) values ('aaaaaaaa-0000-0000-ac73-000000000001',
  '[["low","low","low","low","low"],["low","low","low","low","low"],["low","low","low","low","low"],["low","low","low","low","low"],["low","low","low","low","low"]]', 'Everything is fine');
do $$ begin
  assert app.risk_level('aaaaaaaa-0000-0000-ac73-000000000001', 'likely', 'catastrophic') = 'low', 'the company''s matrix rates now';
  assert app.risk_level('aaaaaaaa-0000-0000-ac73-000000000002', 'likely', 'catastrophic') = 'extreme', 'the other company keeps the built-in';
  assert (select inherent_level from public.risks where id = 'dddddddd-0000-0000-ac73-000000000001') = 'extreme', 'a rating already made keeps its level';
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-ac73-000000000001","role":"authenticated"}', true);
insert into public.risks (id, org_id, profile_id, task, hazard, inherent_likelihood, inherent_consequence, inherent_level) values
  ('dddddddd-0000-0000-ac73-000000000003', 'aaaaaaaa-0000-0000-ac73-000000000001', 'cccccccc-0000-0000-ac73-000000000001', 'Backfill', 'Dust', 'likely', 'catastrophic', 'extreme');
do $$ begin assert (select inherent_level from public.risks where id = 'dddddddd-0000-0000-ac73-000000000003') = 'low', 'rated on the company''s matrix'; end $$;
reset role;
do $$ begin raise notice 'PASS  3 numbered per company; the matrix stamps the level; the company''s own matrix from then on'; end $$;

-- 4. Controls: existing is in place from the start; planned is an action in the register, assignee may move it,
--    the register closes it into place; withdrawn needs a reason then frozen; never deleted.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-ac73-000000000001","role":"authenticated"}', true);
set local role authenticated;
insert into public.risk_controls (id, risk_id, description, level, kind, critical) values
  ('eeeeeeee-0000-0000-ac73-000000000001', 'dddddddd-0000-0000-ac73-000000000001', 'Bench and batter to the geotech', 'engineering', 'existing', true);
insert into public.risk_controls (id, risk_id, description, level, kind, due_on, priority, assigned_to) values
  ('eeeeeeee-0000-0000-ac73-000000000002', 'dddddddd-0000-0000-ac73-000000000001', 'Trench shields on site', 'isolation', 'planned', '2026-11-20', 'high', '00000000-0000-0000-ac73-000000000002');
do $$ declare r record; begin
  select * into r from public.risk_controls where id = 'eeeeeeee-0000-0000-ac73-000000000001';
  assert r.status = 'in_place' and r.in_place_at is not null and r.in_place_by = '00000000-0000-0000-ac73-000000000001', 'existing is in place from the start: ' || row_to_json(r)::text;
  select * into r from public.risk_controls where id = 'eeeeeeee-0000-0000-ac73-000000000002';
  assert r.status = 'planned' and r.in_place_at is null and r.assigned_at is not null, 'planned waits: ' || row_to_json(r)::text;
  select * into r from public.action_register where origin = 'risk' and id = 'eeeeeeee-0000-0000-ac73-000000000002';
  assert r.record_ref = 'RSK-001' and r.record_id = 'cccccccc-0000-0000-ac73-000000000001' and r.project_id = 'bbbbbbbb-0000-0000-ac73-000000000001' and r.due_on = '2026-11-20'::date and r.priority = 'high' and r.done_at is null, 'the planned control is an action: ' || row_to_json(r)::text;
  assert (select count(*) from public.action_register where origin = 'risk') = 1, 'the existing control is not an action';
end $$;
select tests.expect_error($q$ insert into public.risk_controls (risk_id, description, kind, assigned_to) values ('dddddddd-0000-0000-ac73-000000000001', 'X', 'planned', '00000000-0000-0000-ac73-000000000006') $q$, 'someone on the job');
select tests.expect_error($q$ update public.risk_controls set kind = 'existing' where id = 'eeeeeeee-0000-0000-ac73-000000000002' $q$, 'what it was when assessed');
-- The leading hand holds the action: may move its date through the register, may not touch the risk.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-ac73-000000000002","role":"authenticated"}', true);
select public.update_action('risk', 'eeeeeeee-0000-0000-ac73-000000000002', '00000000-0000-0000-ac73-000000000002', 'critical', '2026-11-25', 'Lee');
-- Under RLS an update with no policy touches no row; the proof is that nothing changed.
update public.risks set critical = false where id = 'dddddddd-0000-0000-ac73-000000000001';
do $$ begin assert (select critical from public.risks where id = 'dddddddd-0000-0000-ac73-000000000001'), 'the leading hand changed the risk'; end $$;
do $$ declare r record; begin
  select * into r from public.risk_controls where id = 'eeeeeeee-0000-0000-ac73-000000000002';
  assert r.due_on = '2026-11-25'::date and r.priority = 'critical' and r.owner_name = 'Lee', 'the assignee moved it: ' || row_to_json(r)::text;
end $$;
select public.complete_action('risk', 'eeeeeeee-0000-0000-ac73-000000000002', 'Shields delivered and in the trench');
do $$ declare r record; begin
  select * into r from public.risk_controls where id = 'eeeeeeee-0000-0000-ac73-000000000002';
  assert r.status = 'in_place' and r.in_place_at is not null and r.in_place_by = '00000000-0000-0000-ac73-000000000002' and r.in_place_note = 'Shields delivered and in the trench', 'completing the action puts the control in place: ' || row_to_json(r)::text;
  select * into r from public.action_register where origin = 'risk' and id = 'eeeeeeee-0000-0000-ac73-000000000002';
  assert r.done_at is not null and r.done_note = 'Shields delivered and in the trench', 'the register shows it done';
end $$;
select tests.expect_error($q$ select public.complete_action('risk', 'eeeeeeee-0000-0000-ac73-000000000002', 'again') $q$, 'not on the file');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-ac73-000000000001","role":"authenticated"}', true);
select tests.expect_error($q$ update public.risk_controls set status = 'planned' where id = 'eeeeeeee-0000-0000-ac73-000000000002' $q$, 'stays in place');
select tests.expect_error($q$ update public.risk_controls set status = 'withdrawn' where id = 'eeeeeeee-0000-0000-ac73-000000000001' $q$, 'say why');
update public.risk_controls set status = 'withdrawn', withdrawn_reason = 'Geotech revised — batter not enough' where id = 'eeeeeeee-0000-0000-ac73-000000000001';
select tests.expect_error($q$ update public.risk_controls set description = 'Changed' where id = 'eeeeeeee-0000-0000-ac73-000000000001' $q$, 'frozen');
reset role;
select tests.expect_error($q$ delete from public.risk_controls where id = 'eeeeeeee-0000-0000-ac73-000000000001' $q$, 'never changed or removed');
do $$ begin raise notice 'PASS  4 existing is in place; planned is an action the assignee moves and closes into place; withdrawn with a reason, then frozen'; end $$;

-- 5. A risk closes with a reason and freezes; takes no new control; a closed profile takes no new risk.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-ac73-000000000001","role":"authenticated"}', true);
set local role authenticated;
select tests.expect_error($q$ update public.risks set status = 'closed' where id = 'dddddddd-0000-0000-ac73-000000000002' $q$, 'say why');
select tests.expect_error($q$ update public.risks set seq = 9 where id = 'dddddddd-0000-0000-ac73-000000000002' $q$, 'keeps its number');
update public.risks set status = 'closed', closed_reason = 'Services located and isolated' where id = 'dddddddd-0000-0000-ac73-000000000002';
select tests.expect_error($q$ update public.risks set task = 'Changed' where id = 'dddddddd-0000-0000-ac73-000000000002' $q$, 'frozen');
select tests.expect_error($q$ insert into public.risk_controls (risk_id, description, kind) values ('dddddddd-0000-0000-ac73-000000000002', 'Late', 'existing') $q$, 'closed risk');
do $$ begin assert (select closed_by from public.risks where id = 'dddddddd-0000-0000-ac73-000000000002') = '00000000-0000-0000-ac73-000000000001', 'closed_by is the caller'; end $$;
reset role;
select tests.expect_error($q$ delete from public.risks where id = 'dddddddd-0000-0000-ac73-000000000002' $q$, 'never deleted');
do $$ begin raise notice 'PASS  5 a risk closes with a reason and freezes'; end $$;

-- 6. Reviews count forward: due from the day made, then from the last review; a review in the future refused; an
--    archived profile takes none and its review due is null; the SWMS feed holds one risk per step.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-ac73-000000000001","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  assert app.risk_profile_review_due('cccccccc-0000-0000-ac73-000000000001') = ((now() at time zone 'Australia/Perth')::date + interval '6 months')::date, 'six months from the day made';
end $$;
select tests.expect_error($q$ insert into public.risk_profile_reviews (profile_id, reviewed_on, reviewed_by_name) values ('cccccccc-0000-0000-ac73-000000000001', (now() at time zone 'Australia/Perth')::date + 1, 'Sue') $q$, 'future');
insert into public.risk_profile_reviews (profile_id, reviewed_on, reviewed_by_name, note) values ('cccccccc-0000-0000-ac73-000000000001', '2026-01-10', 'Sue', 'Nothing changed');
insert into public.risk_profile_reviews (profile_id, reviewed_on, reviewed_by_name) values ('cccccccc-0000-0000-ac73-000000000001', '2026-03-10', 'Sue');
do $$ begin assert app.risk_profile_review_due('cccccccc-0000-0000-ac73-000000000001') = '2026-09-10'::date, 'six months from the last review: ' || app.risk_profile_review_due('cccccccc-0000-0000-ac73-000000000001'); end $$;
reset role;
select tests.expect_error($q$ delete from public.risk_profile_reviews where profile_id = 'cccccccc-0000-0000-ac73-000000000001' $q$, 'never changed or removed');
-- A SWMS on the job, written as the record keeps it (its own policies are suite 36's business).
insert into public.swms (id, project_id, title, kind, created_by, steps) values
  ('ffffffff-0000-0000-ac73-000000000001', 'bbbbbbbb-0000-0000-ac73-000000000001', 'Trench works', 'swms', '00000000-0000-0000-ac73-000000000001', '[{"step":"Set up","hazards":"Traffic","risk_before":"high","controls":"TMP","risk_after":"medium","who":null}]');
set local role authenticated;
insert into public.risks (org_id, profile_id, task, step, hazard, inherent_level, residual_level, source_swms_id, source_step) values
  ('aaaaaaaa-0000-0000-ac73-000000000001', 'cccccccc-0000-0000-ac73-000000000001', 'Trench works', 'Set up', 'Traffic', 'high', 'medium', 'ffffffff-0000-0000-ac73-000000000001', 1);
select tests.expect_error($q$ insert into public.risks (org_id, profile_id, task, hazard, inherent_level, source_swms_id, source_step) values ('aaaaaaaa-0000-0000-ac73-000000000001', 'cccccccc-0000-0000-ac73-000000000001', 'Trench works', 'Traffic', 'high', 'ffffffff-0000-0000-ac73-000000000001', 1) $q$, 'risks_source_once');
select tests.expect_error($q$ insert into public.risks (org_id, profile_id, task, hazard, inherent_level, source_swms_id) values ('aaaaaaaa-0000-0000-ac73-000000000001', 'cccccccc-0000-0000-ac73-000000000001', 'T', 'H', 'high', 'ffffffff-0000-0000-ac73-000000000001') $q$, 'risks_source_whole');
update public.risk_profiles set status = 'archived', archived_reason = 'Stage 2 complete' where id = 'cccccccc-0000-0000-ac73-000000000001';
select tests.expect_error($q$ update public.risk_profiles set name = 'Changed' where id = 'cccccccc-0000-0000-ac73-000000000001' $q$, 'frozen');
select tests.expect_error($q$ insert into public.risks (org_id, profile_id, task, hazard, inherent_level) values ('aaaaaaaa-0000-0000-ac73-000000000001', 'cccccccc-0000-0000-ac73-000000000001', 'T', 'H', 'low') $q$, 'archived profile');
select tests.expect_error($q$ insert into public.risk_profile_reviews (profile_id, reviewed_on, reviewed_by_name) values ('cccccccc-0000-0000-ac73-000000000001', '2026-04-01', 'Sue') $q$, 'archived');
do $$ begin assert app.risk_profile_review_due('cccccccc-0000-0000-ac73-000000000001') is null, 'archived has no review due'; end $$;
reset role;
do $$ begin raise notice 'PASS  6 reviews count forward; the SWMS feed holds one risk per step; archived is frozen'; end $$;

-- 7. Reads: the leading hand reads the job's register; the labourer reads none of it, in the tables or the action
--    register; the other company sees nothing.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-ac73-000000000002","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  assert (select count(*) from public.risk_profiles) = 2, 'the leading hand reads the profiles';
  assert (select count(*) from public.risks) = 4, 'the leading hand reads the risks';
  assert (select count(*) from public.risk_controls) = 2, 'the leading hand reads the controls';
  assert (select count(*) from public.org_risk_matrices) = 1, 'the leading hand reads the matrix';
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-ac73-000000000003","role":"authenticated"}', true);
do $$ begin
  assert (select count(*) from public.risk_profiles) = 0, 'the labourer reads profiles';
  assert (select count(*) from public.risks) = 0, 'the labourer reads risks';
  assert (select count(*) from public.risk_controls) = 0, 'the labourer reads controls';
  assert (select count(*) from public.risk_profile_reviews) = 0, 'the labourer reads reviews';
  assert (select count(*) from public.action_register where origin = 'risk') = 0, 'the labourer reads risk actions';
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-ac73-000000000006","role":"authenticated"}', true);
do $$ begin
  assert (select count(*) from public.risk_profiles) = 0, 'another company reads profiles';
  assert (select count(*) from public.org_risk_matrices) = 0, 'another company reads the matrix';
end $$;
reset role;
do $$ begin raise notice 'PASS  7 the leading hand reads, the labourer and the other company read none'; end $$;

rollback;
