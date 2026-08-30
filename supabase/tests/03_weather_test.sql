-- ============================================================================
-- supabase/tests/03_weather_test.sql
--
-- Covers the weather migration:
--   * observation provenance is part of the signed record
--   * the §4 rule — a weather delay on a day with no recorded rainfall is
--     flagged for the supervisor to confirm, and never blocks signing
--   * the BOM snapshot cache is invisible to every client
--
-- Runs in one transaction and rolls back.
-- ============================================================================

begin;

create schema tests;
grant usage on schema tests to public;

create function tests.expect_error(p_sql text, p_fragment text)
returns void
language plpgsql
as $$
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
  ('11111111-1111-1111-1111-111111111111', 'sup1@example.com');

insert into public.organisations (id, name, code)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'Kingsbridge Civil', 'KBS');

insert into public.projects (id, org_id, name, code, site_lat, site_lng, bom_product_id)
values ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
        'Northern Interchange', 'C001', -31.9523, 115.8613, 'IDW60920');

insert into public.project_members (project_id, user_id, role)
values ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'supervisor');

insert into public.entries (id, project_id, entry_date, author_id) values
  ('cccccccc-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001',
   date '2026-08-25', '11111111-1111-1111-1111-111111111111');

-- ---------------------------------------------------------------------------
-- 1. Only the seven state products are accepted
-- ---------------------------------------------------------------------------
select tests.expect_error($q$
  update public.projects set bom_product_id = 'IDX99999'
   where id = 'bbbbbbbb-0000-0000-0000-000000000001'
$q$, 'projects_bom_product_id_check');

do $$ begin raise notice 'PASS  only real BOM products can be pinned'; end; $$;

-- ---------------------------------------------------------------------------
-- 2. Provenance is part of the signed record
-- ---------------------------------------------------------------------------
insert into public.weather (
  entry_id, temp_max, temp_min, rainfall_mm, wind_dir, wind_kmh, source,
  station_id, station_name, station_distance_km, observed_from, observed_to, fetched_at
) values (
  'cccccccc-0000-0000-0000-000000000001', 21.10, 9.80, 0.00, 'NNW', 7.00, 'bom_auto',
  '94608', 'PERTH METRO', 4.2,
  timestamptz '2026-08-25T06:00:00+08:00', timestamptz '2026-08-25T19:22:00+08:00', now()
);

do $$
declare h_before text; h_after text;
begin
  select app.entry_content_hash(e) into h_before
    from public.entries e where e.id = 'cccccccc-0000-0000-0000-000000000001';

  -- The same numbers from a different gauge are a different claim.
  update public.weather set station_id = '94151', station_name = 'PERTH AIRPORT'
   where entry_id = 'cccccccc-0000-0000-0000-000000000001';

  select app.entry_content_hash(e) into h_after
    from public.entries e where e.id = 'cccccccc-0000-0000-0000-000000000001';

  assert h_before <> h_after, 'the station is not part of the content hash';
  raise notice 'PASS  which station the numbers came from is part of the record';
end;
$$;

select tests.expect_error($q$
  update public.weather
     set observed_from = timestamptz '2026-08-25T19:00:00+08:00',
         observed_to   = timestamptz '2026-08-25T06:00:00+08:00'
   where entry_id = 'cccccccc-0000-0000-0000-000000000001'
$q$, 'weather_observation_window');

do $$ begin raise notice 'PASS  an observation window cannot run backwards'; end; $$;

-- ---------------------------------------------------------------------------
-- 3. A weather delay on a dry day is flagged, not blocked (brief §4)
-- ---------------------------------------------------------------------------
insert into public.delays (entry_id, start_time, end_time, duration_mins, cause, category)
values ('cccccccc-0000-0000-0000-000000000001', time '09:30', time '11:15', 105,
        'Rain on the deck', 'weather');

update public.weather set station_distance_km = 30.0
 where entry_id = 'cccccccc-0000-0000-0000-000000000001';

do $$
declare w text[];
begin
  w := app.entry_warnings('cccccccc-0000-0000-0000-000000000001');
  assert 'weather_delay_without_rainfall' = any(w),
         format('expected the dry-day warning, got %s', w);
  assert 'weather_station_far_from_site' = any(w),
         format('expected the distance warning, got %s', w);

  -- A warning is a question for the supervisor, never a veto.
  assert app.entry_blocking_gaps('cccccccc-0000-0000-0000-000000000001') = '{}',
         'a warning leaked into the blocking gaps';
  raise notice 'PASS  dry-day weather delay is flagged, and does not block';
end;
$$;

update public.entries set status = 'signed'
 where id = 'cccccccc-0000-0000-0000-000000000001';

do $$
begin
  assert (select status from public.entries
           where id = 'cccccccc-0000-0000-0000-000000000001') = 'signed',
         'warnings prevented signing';
  raise notice 'PASS  an entry with warnings still signs';
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Rain on the record clears the warning; no record at all raises its own
-- ---------------------------------------------------------------------------
insert into public.entries (id, project_id, entry_date, author_id)
values ('cccccccc-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000001',
        date '2026-08-26', '11111111-1111-1111-1111-111111111111');

insert into public.delays (entry_id, start_time, end_time, cause, category)
values ('cccccccc-0000-0000-0000-000000000002', time '13:00', time '15:00', 'Storm', 'weather');

do $$
begin
  assert 'weather_delay_without_weather_record'
         = any(app.entry_warnings('cccccccc-0000-0000-0000-000000000002')),
         'a weather delay with no weather at all was not flagged';
end;
$$;

insert into public.weather (entry_id, rainfall_mm, source, station_distance_km)
values ('cccccccc-0000-0000-0000-000000000002', 12.60, 'bom_auto', 4.2);

do $$
declare w text[];
begin
  w := app.entry_warnings('cccccccc-0000-0000-0000-000000000002');
  assert w = '{}', format('a wet day should raise nothing, got %s', w);
  raise notice 'PASS  recorded rainfall clears the warning; a missing record raises its own';
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. A supervisor's own reading is theirs
-- ---------------------------------------------------------------------------
insert into public.entries (id, project_id, entry_date, author_id)
values ('cccccccc-0000-0000-0000-000000000003', 'bbbbbbbb-0000-0000-0000-000000000001',
        date '2026-08-27', '11111111-1111-1111-1111-111111111111');

insert into public.weather (entry_id, rainfall_mm, source, observed_impact)
values ('cccccccc-0000-0000-0000-000000000003', 40.00, 'manual',
        'Gauge on site read 40mm, station well short of it');

do $$
begin
  assert (select source from public.weather
           where entry_id = 'cccccccc-0000-0000-0000-000000000003')::text = 'manual',
         'manual source not stored';
  raise notice 'PASS  a hand-entered reading is recorded as manual';
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. The BOM cache belongs to the server alone
-- ---------------------------------------------------------------------------
-- Tolerant: on the hosted database the real weather cache already holds this
-- product. The test's point is that no client can SEE the row, not that this
-- insert created it.
insert into public.bom_snapshots (product_id, issued_at, station_count, stations)
values ('IDW60920', now(), 148, '[{"name":"PERTH METRO"}]'::jsonb)
on conflict (product_id) do nothing;

select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;

do $$
begin
  assert (select count(*) from public.bom_snapshots) = 0,
         'a supervisor can read the BOM snapshot cache';
  raise notice 'PASS  the BOM cache is invisible to clients';
end;
$$;

select tests.expect_error($q$
  insert into public.bom_snapshots (product_id) values ('IDN60920')
$q$, 'row-level security');

reset role;
select set_config('request.jwt.claims', '', true);

do $$ begin raise notice ''; raise notice 'ALL WEATHER TESTS PASSED'; end; $$;

rollback;
