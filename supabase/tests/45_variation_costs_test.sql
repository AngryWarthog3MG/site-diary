-- Variation costing (README R104): the rate card's doors; the build-up's arithmetic done by the database; the build-up
-- is the estimate and a typed estimate cannot overwrite it; a submitted variation's lines are frozen and the total is
-- stamped on the submission; back to Priced opens them; removing the item takes its lines.
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

-- People: pm, supervisor, leading hand, labourer on job A; an admin on job B only; someone at another company.
insert into auth.users (id, email) values
  ('11111111-dddd-0000-0000-000000000001', 'pm.vc@example.com'),
  ('11111111-dddd-0000-0000-000000000002', 'sup.vc@example.com'),
  ('11111111-dddd-0000-0000-000000000003', 'lh.vc@example.com'),
  ('11111111-dddd-0000-0000-000000000004', 'lab.vc@example.com'),
  ('11111111-dddd-0000-0000-000000000005', 'adminb.vc@example.com');
insert into public.organisations (id, name, code) values
  ('aaaaaaaa-dddd-0000-0000-000000000001', 'Cost Civil', 'VCC'),
  ('aaaaaaaa-dddd-0000-0000-000000000002', 'Other Civil', 'VCO');
insert into public.projects (id, org_id, name, code) values
  ('bbbbbbbb-dddd-0000-0000-000000000001', 'aaaaaaaa-dddd-0000-0000-000000000001', 'Cost Job A', 'X201'),
  ('bbbbbbbb-dddd-0000-0000-000000000002', 'aaaaaaaa-dddd-0000-0000-000000000001', 'Cost Job B', 'X202');
insert into public.project_members (project_id, user_id, role) values
  ('bbbbbbbb-dddd-0000-0000-000000000001', '11111111-dddd-0000-0000-000000000001', 'pm'),
  ('bbbbbbbb-dddd-0000-0000-000000000001', '11111111-dddd-0000-0000-000000000002', 'supervisor'),
  ('bbbbbbbb-dddd-0000-0000-000000000001', '11111111-dddd-0000-0000-000000000003', 'leading_hand'),
  ('bbbbbbbb-dddd-0000-0000-000000000001', '11111111-dddd-0000-0000-000000000004', 'labourer'),
  ('bbbbbbbb-dddd-0000-0000-000000000002', '11111111-dddd-0000-0000-000000000005', 'admin');
-- This supervisor prices variations: an admin has shown them the money (README R105; suite 46 covers the default).
update public.project_members set finance = true where user_id = '11111111-dddd-0000-0000-000000000002';
insert into public.plant_register (id, org_id, name, kind) values
  ('eeeeeeee-dddd-0000-0000-000000000001', 'aaaaaaaa-dddd-0000-0000-000000000001', 'Excavator 5t', 'excavator'),
  ('eeeeeeee-dddd-0000-0000-000000000002', 'aaaaaaaa-dddd-0000-0000-000000000002', 'Their roller', 'roller');
insert into public.variation_register (id, project_id, title, raised_on) values
  ('cccccccc-dddd-0000-0000-000000000001', 'bbbbbbbb-dddd-0000-0000-000000000001', 'Extra trenching', '2026-09-16'),
  ('cccccccc-dddd-0000-0000-000000000002', 'bbbbbbbb-dddd-0000-0000-000000000001', 'Kerb repair', '2026-09-17');

-- A signed day that records V-001 on two rows (Curtin's 17/09 did): each row is brought in once, both count.
insert into public.entries (id, project_id, entry_date, author_id, status) values
  ('99999999-dddd-0000-0000-000000000001', 'bbbbbbbb-dddd-0000-0000-000000000001', '2026-09-17', '11111111-dddd-0000-0000-000000000002', 'draft');
insert into public.variations (id, entry_id, description, register_seq, hours) values
  ('88888888-dddd-0000-0000-000000000001', '99999999-dddd-0000-0000-000000000001', 'Marcus, Hamish on vac trailer', 1, 10),
  ('88888888-dddd-0000-0000-000000000002', '99999999-dddd-0000-0000-000000000001', 'Matt and Evan widening trench', 1, 6);

set local role authenticated;

-- ---- The rate card ----------------------------------------------------------------------------------------------
-- The PM writes the company's rates and job A's own.
set local request.jwt.claims = '{"sub":"11111111-dddd-0000-0000-000000000001","role":"authenticated"}';
insert into public.rate_items (id, org_id, kind, label, unit, rate) values
  ('ffffffff-dddd-0000-0000-000000000001', 'aaaaaaaa-dddd-0000-0000-000000000001', 'labour', '  Labourer ', 'hour', 95),
  ('ffffffff-dddd-0000-0000-000000000002', 'aaaaaaaa-dddd-0000-0000-000000000001', 'plant', 'Excavator 5t', 'hour', 150);
update public.rate_items set plant_id = 'eeeeeeee-dddd-0000-0000-000000000001' where id = 'ffffffff-dddd-0000-0000-000000000002';
insert into public.rate_items (id, org_id, project_id, kind, label, unit, rate) values
  ('ffffffff-dddd-0000-0000-000000000003', 'aaaaaaaa-dddd-0000-0000-000000000001', 'bbbbbbbb-dddd-0000-0000-000000000001', 'labour', 'Labourer', 'hour', 105);
do $$
begin
  if (select label from public.rate_items where id = 'ffffffff-dddd-0000-0000-000000000001') <> 'Labourer' then raise exception 'TESTFAIL: label not tidied'; end if;
end; $$;
-- One live rate per label per card: the company card already has a Labourer.
select tests.expect_error($$ insert into public.rate_items (org_id, kind, label, rate) values ('aaaaaaaa-dddd-0000-0000-000000000001', 'labour', 'labourer', 90) $$, 'duplicate key');
-- A machine from another company, and a rate for a job the PM is not on, are refused.
select tests.expect_error($$ insert into public.rate_items (org_id, kind, label, plant_id, rate) values ('aaaaaaaa-dddd-0000-0000-000000000001', 'plant', 'Roller', 'eeeeeeee-dddd-0000-0000-000000000002', 80) $$, 'plant register');
select tests.expect_error($$ insert into public.rate_items (org_id, project_id, kind, label, rate) values ('aaaaaaaa-dddd-0000-0000-000000000001', 'bbbbbbbb-dddd-0000-0000-000000000002', 'labour', 'Operator', 120) $$, 'row-level security');
-- A change is kept.
update public.rate_items set rate = 98 where id = 'ffffffff-dddd-0000-0000-000000000001';
do $$
declare r record;
begin
  select * into r from public.rate_item_changes where rate_item_id = 'ffffffff-dddd-0000-0000-000000000001';
  if r.old_rate <> 95 or r.new_rate <> 98 or r.changed_by <> '11111111-dddd-0000-0000-000000000001' then raise exception 'TESTFAIL: rate change not kept: % % %', r.old_rate, r.new_rate, r.changed_by; end if;
end; $$;
select tests.expect_error($$ update public.rate_items set kind = 'plant' where id = 'ffffffff-dddd-0000-0000-000000000001' $$, 'keeps its company');

-- The supervisor reads the card but cannot write it.
set local request.jwt.claims = '{"sub":"11111111-dddd-0000-0000-000000000002","role":"authenticated"}';
do $$
begin
  if (select count(*) from public.rate_items where org_id = 'aaaaaaaa-dddd-0000-0000-000000000001') <> 3 then raise exception 'TESTFAIL: supervisor should read 3 rates'; end if;
end; $$;
select tests.expect_error($$ insert into public.rate_items (org_id, kind, label, rate) values ('aaaaaaaa-dddd-0000-0000-000000000001', 'labour', 'Supervisor', 130) $$, 'row-level security');
do $$
declare n integer;
begin
  update public.rate_items set rate = 1 where id = 'ffffffff-dddd-0000-0000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'TESTFAIL: supervisor changed a rate'; end if;
end; $$;

-- The leading hand and the labourer read no rates.
set local request.jwt.claims = '{"sub":"11111111-dddd-0000-0000-000000000003","role":"authenticated"}';
do $$ begin if (select count(*) from public.rate_items) <> 0 then raise exception 'TESTFAIL: leading hand reads rates'; end if; end; $$;
set local request.jwt.claims = '{"sub":"11111111-dddd-0000-0000-000000000004","role":"authenticated"}';
do $$ begin if (select count(*) from public.rate_items) <> 0 then raise exception 'TESTFAIL: labourer reads rates'; end if; end; $$;
-- Job B's admin reads the company card but not job A's own rate.
set local request.jwt.claims = '{"sub":"11111111-dddd-0000-0000-000000000005","role":"authenticated"}';
do $$ begin if (select count(*) from public.rate_items) <> 2 then raise exception 'TESTFAIL: job B admin should read the 2 company rates only, got %', (select count(*) from public.rate_items); end if; end; $$;

-- ---- The build-up -----------------------------------------------------------------------------------------------
-- A typed estimate first, then the supervisor builds it up.
set local request.jwt.claims = '{"sub":"11111111-dddd-0000-0000-000000000002","role":"authenticated"}';
select public.set_variation_details('cccccccc-dddd-0000-0000-000000000001', null, null, null, 5000, false);
insert into public.variation_cost_lines (id, register_id, project_id, kind, description, person_name, quantity, unit, rate, rate_item_id, work_date) values
  ('dddddddd-dddd-0000-0000-000000000001', 'cccccccc-dddd-0000-0000-000000000001', 'bbbbbbbb-dddd-0000-0000-000000000001', 'labour', 'Labourer', 'Sam Test', 8, 'hour', 105, 'ffffffff-dddd-0000-0000-000000000003', '2026-09-16');
insert into public.variation_cost_lines (id, register_id, project_id, kind, description, plant_id, quantity, unit, rate) values
  ('dddddddd-dddd-0000-0000-000000000002', 'cccccccc-dddd-0000-0000-000000000001', 'bbbbbbbb-dddd-0000-0000-000000000001', 'plant', 'Excavator 5t', 'eeeeeeee-dddd-0000-0000-000000000001', 4.5, 'hour', 150);
-- A material with no price yet: its amount is blank, not zero.
insert into public.variation_cost_lines (id, register_id, project_id, kind, description, quantity, unit) values
  ('dddddddd-dddd-0000-0000-000000000003', 'cccccccc-dddd-0000-0000-000000000001', 'bbbbbbbb-dddd-0000-0000-000000000001', 'material', 'Road base', 12, 't');
do $$
declare r record;
begin
  if (select amount from public.variation_cost_lines where id = 'dddddddd-dddd-0000-0000-000000000001') <> 840 then raise exception 'TESTFAIL: 8 x 105 should be 840'; end if;
  if (select amount from public.variation_cost_lines where id = 'dddddddd-dddd-0000-0000-000000000002') <> 675 then raise exception 'TESTFAIL: 4.5 x 150 should be 675'; end if;
  if (select amount from public.variation_cost_lines where id = 'dddddddd-dddd-0000-0000-000000000003') is not null then raise exception 'TESTFAIL: no rate should be no amount'; end if;
  select v.estimated_cost, v.estimate_source, reg.vr_ref into r from public.variation_values('bbbbbbbb-dddd-0000-0000-000000000001') v join public.variation_register reg on reg.id = v.register_id where v.register_id = 'cccccccc-dddd-0000-0000-000000000001';
  if r.estimated_cost <> 1515 or r.estimate_source <> 'build_up' then raise exception 'TESTFAIL: build-up should be the estimate: % %', r.estimated_cost, r.estimate_source; end if;
end; $$;
-- The typed estimate cannot overwrite it; the agreed value and the reference still save.
select public.set_variation_details('cccccccc-dddd-0000-0000-000000000001', 'VR-9', null, 'from the rates', 99, false);
do $$
declare r record;
begin
  select v.estimated_cost, v.estimate_source, reg.vr_ref into r from public.variation_values('bbbbbbbb-dddd-0000-0000-000000000001') v join public.variation_register reg on reg.id = v.register_id where v.register_id = 'cccccccc-dddd-0000-0000-000000000001';
  if r.estimated_cost <> 1515 or r.vr_ref <> 'VR-9' then raise exception 'TESTFAIL: typed estimate overwrote the build-up: % %', r.estimated_cost, r.vr_ref; end if;
end; $$;
-- Pricing the material moves the total.
update public.variation_cost_lines set rate = 32.5 where id = 'dddddddd-dddd-0000-0000-000000000003';
do $$ begin if (select estimated_cost from public.variation_values('bbbbbbbb-dddd-0000-0000-000000000001') where register_id = 'cccccccc-dddd-0000-0000-000000000001') <> 1905 then raise exception 'TESTFAIL: 1515 + 12 x 32.5 should be 1905'; end if; end; $$;
-- Refusals: a negative, a day in the future, a machine from another company, a person on a plant line, the wrong job's day.
select tests.expect_error($$ insert into public.variation_cost_lines (register_id, project_id, kind, description, quantity, rate) values ('cccccccc-dddd-0000-0000-000000000001', 'bbbbbbbb-dddd-0000-0000-000000000001', 'labour', 'Labourer', -1, 95) $$, 'check');
select tests.expect_error($$ insert into public.variation_cost_lines (register_id, project_id, kind, description, quantity, rate, work_date) values ('cccccccc-dddd-0000-0000-000000000001', 'bbbbbbbb-dddd-0000-0000-000000000001', 'labour', 'Labourer', 1, 95, current_date + 3) $$, 'future');
select tests.expect_error($$ insert into public.variation_cost_lines (register_id, project_id, kind, description, plant_id, quantity, rate) values ('cccccccc-dddd-0000-0000-000000000001', 'bbbbbbbb-dddd-0000-0000-000000000001', 'plant', 'Roller', 'eeeeeeee-dddd-0000-0000-000000000002', 1, 80) $$, 'plant register');
select tests.expect_error($$ insert into public.variation_cost_lines (register_id, project_id, kind, description, person_name, quantity, rate) values ('cccccccc-dddd-0000-0000-000000000001', 'bbbbbbbb-dddd-0000-0000-000000000001', 'plant', 'Excavator', 'Sam', 1, 80) $$, 'person_on_labour');
select tests.expect_error($$ update public.variation_cost_lines set register_id = 'cccccccc-dddd-0000-0000-000000000002' where id = 'dddddddd-dddd-0000-0000-000000000001' $$, 'stays on its variation');
select tests.expect_error($$ update public.variation_cost_lines set amount = 1 where id = 'dddddddd-dddd-0000-0000-000000000001' $$, 'only be updated to DEFAULT');

-- The leading hand neither reads nor writes the build-up.
set local request.jwt.claims = '{"sub":"11111111-dddd-0000-0000-000000000003","role":"authenticated"}';
do $$ begin if (select count(*) from public.variation_cost_lines) <> 0 then raise exception 'TESTFAIL: leading hand reads the build-up'; end if; end; $$;
select tests.expect_error($$ insert into public.variation_cost_lines (register_id, project_id, kind, description, quantity, rate) values ('cccccccc-dddd-0000-0000-000000000001', 'bbbbbbbb-dddd-0000-0000-000000000001', 'labour', 'Labourer', 1, 95) $$, 'row-level security');

-- Two rows on one day: both come in; the same row twice is refused; a row of another variation is refused.
set local request.jwt.claims = '{"sub":"11111111-dddd-0000-0000-000000000002","role":"authenticated"}';
insert into public.variation_cost_lines (id, register_id, project_id, kind, description, source_entry_id, source_variation_id, quantity, rate) values
  ('dddddddd-dddd-0000-0000-000000000011', 'cccccccc-dddd-0000-0000-000000000001', 'bbbbbbbb-dddd-0000-0000-000000000001', 'labour', 'Labour — crew not named', '99999999-dddd-0000-0000-000000000001', '88888888-dddd-0000-0000-000000000001', 10, null),
  ('dddddddd-dddd-0000-0000-000000000012', 'cccccccc-dddd-0000-0000-000000000001', 'bbbbbbbb-dddd-0000-0000-000000000001', 'labour', 'Labour — crew not named', '99999999-dddd-0000-0000-000000000001', '88888888-dddd-0000-0000-000000000002', 6, null);
select tests.expect_error($$ insert into public.variation_cost_lines (register_id, project_id, kind, description, source_entry_id, source_variation_id, quantity) values ('cccccccc-dddd-0000-0000-000000000001', 'bbbbbbbb-dddd-0000-0000-000000000001', 'labour', 'Again', '99999999-dddd-0000-0000-000000000001', '88888888-dddd-0000-0000-000000000002', 6) $$, 'duplicate key');
select tests.expect_error($$ insert into public.variation_cost_lines (register_id, project_id, kind, description, source_variation_id, quantity) values ('cccccccc-dddd-0000-0000-000000000002', 'bbbbbbbb-dddd-0000-0000-000000000001', 'labour', 'Wrong one', '88888888-dddd-0000-0000-000000000001', 6) $$, 'does not record this variation');
delete from public.variation_cost_lines where id in ('dddddddd-dddd-0000-0000-000000000011', 'dddddddd-dddd-0000-0000-000000000012');

-- ---- Submitted is what was claimed ------------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"11111111-dddd-0000-0000-000000000001","role":"authenticated"}';
select public.set_variation_status('cccccccc-dddd-0000-0000-000000000001', 'submitted', 'sent to Lendlease');
do $$
declare e record;
begin
  select * into e from public.variation_submissions('cccccccc-dddd-0000-0000-000000000001');
  if e.claimed_total <> 1905 or e.claimed_lines <> 3 then raise exception 'TESTFAIL: submission should stamp 1905 over 3 lines: % %', e.claimed_total, e.claimed_lines; end if;
end; $$;
select tests.expect_error($$ insert into public.variation_cost_lines (register_id, project_id, kind, description, quantity, rate) values ('cccccccc-dddd-0000-0000-000000000001', 'bbbbbbbb-dddd-0000-0000-000000000001', 'labour', 'Labourer', 1, 95) $$, 'what was claimed');
select tests.expect_error($$ update public.variation_cost_lines set quantity = 9 where id = 'dddddddd-dddd-0000-0000-000000000001' $$, 'what was claimed');
select tests.expect_error($$ delete from public.variation_cost_lines where id = 'dddddddd-dddd-0000-0000-000000000001' $$, 'what was claimed');

-- Back to Priced opens it; removing every line hands the estimate back to typing.
select public.set_variation_status('cccccccc-dddd-0000-0000-000000000001', 'priced', 'client asked for a split');
delete from public.variation_cost_lines where id = 'dddddddd-dddd-0000-0000-000000000003';
do $$ begin if (select estimated_cost from public.variation_values('bbbbbbbb-dddd-0000-0000-000000000001') where register_id = 'cccccccc-dddd-0000-0000-000000000001') <> 1515 then raise exception 'TESTFAIL: removing a line should move the total'; end if; end; $$;
delete from public.variation_cost_lines where register_id = 'cccccccc-dddd-0000-0000-000000000001';
do $$
declare r record;
begin
  select v.estimated_cost, v.estimate_source, reg.vr_ref into r from public.variation_values('bbbbbbbb-dddd-0000-0000-000000000001') v join public.variation_register reg on reg.id = v.register_id where v.register_id = 'cccccccc-dddd-0000-0000-000000000001';
  if r.estimated_cost is not null or r.estimate_source <> 'manual' then raise exception 'TESTFAIL: no lines should mean no build-up: % %', r.estimated_cost, r.estimate_source; end if;
end; $$;
-- The history still says what was claimed when it was sent.
do $$ begin if (select claimed_total from public.variation_submissions('cccccccc-dddd-0000-0000-000000000001')) <> 1905 then raise exception 'TESTFAIL: the submission record moved'; end if; end; $$;

-- ---- Removing an item takes its lines -------------------------------------------------------------------------
insert into public.variation_cost_lines (id, register_id, project_id, kind, description, quantity, rate) values
  ('dddddddd-dddd-0000-0000-000000000009', 'cccccccc-dddd-0000-0000-000000000002', 'bbbbbbbb-dddd-0000-0000-000000000001', 'labour', 'Labourer', 2, 95);
select public.remove_variation_item('cccccccc-dddd-0000-0000-000000000002');
do $$ begin if exists (select 1 from public.variation_cost_lines where id = 'dddddddd-dddd-0000-0000-000000000009') then raise exception 'TESTFAIL: removed item left its line'; end if; end; $$;

rollback;
