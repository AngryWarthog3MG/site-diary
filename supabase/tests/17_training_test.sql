-- Training: the company's competencies and role requirements are the org's, kept by its managers.
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
  ('22222222-2222-2222-2222-222222222222', 'lh@example.com');
insert into public.organisations (id, name, code) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Kingsbridge Civil', 'KBS');
insert into public.projects (id, org_id, name, code) values ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Northern', 'C001');
insert into public.project_members (project_id, user_id, role) values
  ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'supervisor'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'leading_hand');

select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;
insert into public.org_competencies (org_id, key, label, valid_months, created_by) values ('aaaaaaaa-0000-0000-0000-000000000001', 'kbs_induction', 'KBS induction', 24, '11111111-1111-1111-1111-111111111111');
select tests.expect_error($q$
  insert into public.org_competencies (org_id, key, label) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Bad Key!', 'Bad')
$q$, 'org_competencies_key_check');
insert into public.competency_requirements (org_id, role, competency, created_by) values ('aaaaaaaa-0000-0000-0000-000000000001', '  Operator ', 'excavator', '11111111-1111-1111-1111-111111111111');
do $$ begin
  assert (select role from public.competency_requirements where competency = 'excavator') = 'operator', 'role not normalised';
  raise notice 'PASS  competencies are keyed and requirements normalised by role';
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  assert (select count(*) from public.org_competencies) = 1 and (select count(*) from public.competency_requirements) = 1, 'a leading hand cannot read the requirements';
end $$;
select tests.expect_error($q$
  insert into public.competency_requirements (org_id, role, competency) values ('aaaaaaaa-0000-0000-0000-000000000001', 'labourer', 'white_card')
$q$, 'row-level security');
do $$ begin raise notice 'PASS  members read; managers write'; end $$;
reset role;
select set_config('request.jwt.claims', '', true);
do $$ begin raise notice 'ALL TRAINING TESTS PASSED'; end $$;
rollback;
