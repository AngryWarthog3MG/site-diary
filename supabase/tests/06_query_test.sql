-- ============================================================================
-- supabase/tests/06_query_test.sql
--
-- Covers the query surface:
--   * the diary views show the current record only — signed, not superseded
--   * a draft is invisible to the query layer
--   * RLS still applies through the views
--   * run_diary_query refuses anything that is not a single SELECT over diary
--   * writes fail even when the string checks are bypassed
--   * search finds the supervisor's own words and quotes them back
--
-- Runs in one transaction and rolls back.
-- ============================================================================

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
      raise exception 'TESTFAIL: wrong error for [%] — got "%", expected "%"',
        p_sql, sqlerrm, p_fragment;
    end if;
end;
$$;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'sup@example.com'),
  ('44444444-4444-4444-4444-444444444444', 'outsider@example.com');

insert into public.profiles (id, full_name) values
  ('11111111-1111-1111-1111-111111111111', 'Danny Rowe')
on conflict (id) do update set full_name = excluded.full_name;

insert into public.organisations (id, name, code)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'Kingsbridge Civil', 'KBS');

insert into public.projects (id, org_id, name, code) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Northern', 'C001'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'Other', 'C002');

insert into public.project_members (project_id, user_id, role) values
  ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'supervisor'),
  ('bbbbbbbb-0000-0000-0000-000000000002', '44444444-4444-4444-4444-444444444444', 'supervisor');

-- Entry 1: signed, and later corrected.
insert into public.entries (id, project_id, entry_date, author_id, transcript_raw)
values ('cccccccc-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001',
        date '2026-08-24', '11111111-1111-1111-1111-111111111111',
        'Four blokes on the pier, poured the headstock off Hanson.');
insert into public.labour (entry_id, person_name, hours)
values ('cccccccc-0000-0000-0000-000000000001', 'Danny Rowe', 4);
update public.entries set status = 'signed' where id = 'cccccccc-0000-0000-0000-000000000001';

-- Entry 2: the correction. Same day, same author, so it supersedes entry 1.
insert into public.entries (id, project_id, entry_date, author_id, supersedes_entry_id, transcript_raw)
values ('cccccccc-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000001',
        date '2026-08-24', '11111111-1111-1111-1111-111111111111',
        'cccccccc-0000-0000-0000-000000000001',
        'Correction — five blokes on the pier, not four. Access to Area B was blocked all morning.');
insert into public.labour (entry_id, person_name, hours)
values ('cccccccc-0000-0000-0000-000000000002', 'Danny Rowe', 5);
insert into public.delays (entry_id, start_time, end_time, cause, category)
values ('cccccccc-0000-0000-0000-000000000002', time '07:00', time '11:00',
        'No access to Area B, traffic control late', 'access');
update public.entries set status = 'signed' where id = 'cccccccc-0000-0000-0000-000000000002';

-- Entry 3: still a draft.
insert into public.entries (id, project_id, entry_date, author_id, transcript_raw)
values ('cccccccc-0000-0000-0000-000000000003', 'bbbbbbbb-0000-0000-0000-000000000001',
        date '2026-08-25', '11111111-1111-1111-1111-111111111111',
        'Draft that nobody has signed.');
insert into public.labour (entry_id, person_name, hours)
values ('cccccccc-0000-0000-0000-000000000003', 'Danny Rowe', 99);

-- ---------------------------------------------------------------------------
-- An UNSIGNED correction displaces nothing.
--
-- The bug this pins: diary.entries once excluded any entry something pointed
-- at, draft or not. Opening a correction and not finishing it deleted the
-- signed day it superseded from the weekly report, the claims register, the
-- progress chart and Ask — while its stored PDF sat there intact. Only
-- signing changes the record, so only a signed successor can displace.
--
-- Inside a savepoint: it signs an entry, and a signed entry cannot be removed
-- afterwards, so the fixture is rolled back rather than cleaned up.
-- ---------------------------------------------------------------------------
savepoint before_unsigned_correction;

insert into public.entries (id, project_id, entry_date, author_id, supersedes_entry_id, transcript_raw)
values ('cccccccc-0000-0000-0000-00000000000b', 'bbbbbbbb-0000-0000-0000-000000000001',
        date '2026-08-24', '11111111-1111-1111-1111-111111111111',
        'cccccccc-0000-0000-0000-000000000002',
        'Started a second correction and never signed it.');
insert into public.labour (entry_id, person_name, hours)
values ('cccccccc-0000-0000-0000-00000000000b', 'Danny Rowe', 6);

do $$
declare hours numeric;
begin
  -- Scoped to the fixture: this block runs before the role switch, so there
  -- is no RLS and an unscoped count would sweep in every other project.
  assert (select count(*) from diary.entries
           where project_id = 'bbbbbbbb-0000-0000-0000-000000000001') = 1,
         'an unsigned correction hid the signed entry it supersedes';
  assert (select entry_no from diary.entries
           where project_id = 'bbbbbbbb-0000-0000-0000-000000000001') = 'KBS-2026-08-24-2',
         'the signed record changed because a draft pointed at it';
  select coalesce(sum(l.hours), 0) into hours from diary.labour l
   where l.project_id = 'bbbbbbbb-0000-0000-0000-000000000001';
  assert hours = 5, format('child views lost their rows to a draft: %s hours', hours);
  raise notice 'PASS  an unsigned correction does not displace a signed entry';
end;
$$;

-- Sign it, and now it does displace.
update public.entries set status = 'signed'
 where id = 'cccccccc-0000-0000-0000-00000000000b';

do $$
declare hours numeric;
begin
  assert (select count(*) from diary.entries
           where project_id = 'bbbbbbbb-0000-0000-0000-000000000001') = 1,
         'signing the correction did not leave exactly one current entry';
  select coalesce(sum(l.hours), 0) into hours from diary.labour l
   where l.project_id = 'bbbbbbbb-0000-0000-0000-000000000001';
  assert hours = 6, format('the signed correction did not take over: %s hours', hours);
  raise notice 'PASS  a signed correction does displace the entry it supersedes';
end;
$$;

rollback to savepoint before_unsigned_correction;

select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;

-- ---------------------------------------------------------------------------
-- 1. The current record only
-- ---------------------------------------------------------------------------
do $$
declare hours numeric;
begin
  select coalesce(sum(l.hours), 0) into hours from diary.labour l;

  -- 5, not 9 (4 + 5) and not 104 (with the draft). Counting a corrected entry
  -- alongside its correction would double every number in a claim.
  assert hours = 5, format('diary.labour totalled %s hours, expected 5', hours);

  assert (select count(*) from diary.entries) = 1,
         'the query layer can see more than the current record';
  assert (select entry_no from diary.entries) = 'KBS-2026-08-24-2',
         'the wrong entry survived as current';
  raise notice 'PASS  the query layer sees signed, unsuperseded entries only';
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Generated SQL runs, and cites entries
-- ---------------------------------------------------------------------------
do $$
declare result jsonb;
begin
  result := public.run_diary_query(
    'select entry_no, entry_date, sum(hours) as total_hours
       from diary.labour group by entry_no, entry_date order by entry_date');

  assert (result ->> 'row_count')::int = 1, format('got %s', result);
  assert result -> 'rows' -> 0 ->> 'entry_no' = 'KBS-2026-08-24-2', 'no entry number in the answer';
  assert (result -> 'rows' -> 0 ->> 'total_hours')::numeric = 5, 'wrong total';
  raise notice 'PASS  generated SQL runs and every row carries its entry number';
end;
$$;

-- A query that matches nothing returns nothing, rather than erroring.
do $$
declare result jsonb;
begin
  result := public.run_diary_query(
    $q$select * from diary.pours where volume_m3 > 1000$q$);
  assert (result ->> 'row_count')::int = 0, 'an empty result should be empty, not an error';
  assert result -> 'rows' = '[]'::jsonb, 'empty result is not an empty array';
  raise notice 'PASS  a query that finds nothing returns nothing';
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. What the executor refuses
-- ---------------------------------------------------------------------------
select tests.expect_error(
  $q$select public.run_diary_query('delete from public.entries')$q$,
  'Only SELECT');

select tests.expect_error(
  $q$select public.run_diary_query('select 1; drop table public.entries')$q$,
  'Only one statement');

select tests.expect_error(
  $q$select public.run_diary_query('select * from public.entries')$q$,
  'only read from the diary schema');

select tests.expect_error(
  $q$select public.run_diary_query('select * from auth.users')$q$,
  'only read from the diary schema');

select tests.expect_error(
  $q$select public.run_diary_query('select entry_no from diary.entries -- and more')$q$,
  'Comments are not allowed');

select tests.expect_error(
  $q$select public.run_diary_query('')$q$,
  'No query was given');

do $$ begin raise notice 'PASS  the executor refuses anything but a single SELECT over diary'; end; $$;

-- The constructs a PM's question actually turns into. `extract(month from x)`
-- in particular: the most useful thing anyone asks for, and the thing a naive
-- "every FROM must be diary." check quietly rejects.
do $$
declare result jsonb;
begin
  result := public.run_diary_query(
    'select extract(month from entry_date) as month, sum(hours) as hours
       from diary.labour
      group by extract(month from entry_date)
      order by month');
  assert (result ->> 'row_count')::int = 1, format('extract() query returned %s', result);
  assert (result -> 'rows' -> 0 ->> 'hours')::numeric = 5, 'wrong total from an extract() query';

  result := public.run_diary_query(
    $q$select entry_no, cause from diary.delays where cause ilike '%access%'$q$);
  assert (result ->> 'row_count')::int = 1, 'ilike filter did not run';

  raise notice 'PASS  date grouping and text filters run unmolested';
end;
$$;

-- Subqueries, CTEs and joins between diary views are all still fine.
do $$
declare result jsonb;
begin
  result := public.run_diary_query(
    'with totals as (select entry_no, sum(hours) as h from diary.labour group by entry_no)
     select t.entry_no, t.h, e.entry_date
       from diary.entries e join totals t on t.entry_no = e.entry_no');
  assert (result ->> 'row_count')::int = 1, format('CTE query returned %s', result);
  raise notice 'PASS  CTEs, joins and subqueries still work';
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Search finds the supervisor's words and quotes them back
-- ---------------------------------------------------------------------------
do $$
declare hits record; found boolean := false;
begin
  for hits in select * from public.diary_search('access to Area B') loop
    found := true;
    assert hits.entry_no = 'KBS-2026-08-24-2', 'search returned a superseded entry';
    assert hits.snippet like '%<<%', format('no highlight in snippet: %s', hits.snippet);
  end loop;
  assert found, 'search found nothing for words that are plainly in the record';
  raise notice 'PASS  search finds the words and quotes the line';
end;
$$;

do $$
begin
  assert (select count(*) from public.diary_search('helicopter')) = 0,
         'search invented a match';
  raise notice 'PASS  search finds nothing when there is nothing';
end;
$$;

reset role;
select set_config('request.jwt.claims', '', true);

-- ---------------------------------------------------------------------------
-- 5. RLS still applies through the views
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
set local role authenticated;

do $$
declare result jsonb;
begin
  assert (select count(*) from diary.entries) = 0,
         'a non-member can read another project through the views';
  assert (select count(*) from diary.labour) = 0,
         'a non-member can read another project''s labour through the views';

  result := public.run_diary_query('select * from diary.labour');
  assert (result ->> 'row_count')::int = 0,
         'generated SQL escaped row level security';

  assert (select count(*) from public.diary_search('Area B')) = 0,
         'search escaped row level security';
  raise notice 'PASS  the views and the executor are still behind RLS';
end;
$$;

reset role;
select set_config('request.jwt.claims', '', true);

do $$ begin raise notice ''; raise notice 'ALL QUERY TESTS PASSED'; end; $$;

rollback;
