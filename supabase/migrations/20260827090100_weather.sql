-- ============================================================================
-- 20260827090100_weather.sql
-- Weather, fetched from the Bureau of Meteorology by project coordinates
-- (brief §4 — never spoken, never extracted).
--
-- Source of the data: BOM's anonymous FTP channel,
-- ftp://ftp.bom.gov.au/anon/gen/fwo/ID{X}60920.xml — one product per state,
-- carrying the latest observation for every AWS in it. That is the channel the
-- Bureau itself names as supported for automated access; their HTTP JSON feeds
-- refuse it outright, and api.weather.bom.gov.au is served with an explicit
-- "you must not use, copy or share it" notice.
--
-- Because one product covers a whole state, the snapshot is cached per product
-- rather than fetched per supervisor: one pull every few minutes serves every
-- phone on every project in that state.
-- ============================================================================

-- Which state product a project's observations come from. Nullable: inferred
-- from the site coordinates when unset, and the inference is coarse, so the
-- column is there to pin it for a site near a border.
alter table public.projects
  add column bom_product_id text
    check (bom_product_id ~ '^ID[DNQSTVW]60920$');

comment on column public.projects.bom_product_id is
  'BOM state observation product, e.g. IDW60920 for WA. Inferred from site coordinates when null.';

comment on column public.projects.bom_station_id is
  'Pins a specific BOM station by WMO id or BOM id. Nearest station to the site is used when null.';

-- ---------------------------------------------------------------------------
-- Provenance for a stored observation.
--
-- Which station, how far away, and over what window — without these, a
-- "rainfall 0.0 mm" on a signed entry is unfalsifiable. With them it is a
-- specific claim about a specific gauge over a specific period, which is what
-- makes it worth anything in a dispute.
-- ---------------------------------------------------------------------------
alter table public.weather
  add column station_id           text,
  add column station_name         text,
  add column station_distance_km  numeric(6,1) check (station_distance_km >= 0),
  add column observed_from        timestamptz,
  add column observed_to          timestamptz,
  add column fetched_at           timestamptz,
  add constraint weather_observation_window
    check (observed_from is null or observed_to is null or observed_from <= observed_to);

-- These columns join the content hash automatically: canonical_entry_json
-- serialises the whole weather row minus entry_id and created_at.

-- ---------------------------------------------------------------------------
-- Snapshot cache: one row per state product, holding the parsed stations.
--
-- No RLS policies at all, deliberately — service_role bypasses RLS, everyone
-- else is refused. Supervisors read weather through their entry, never from
-- here, and the Bureau should see one poll per state rather than one per phone.
-- ---------------------------------------------------------------------------
create table public.bom_snapshots (
  product_id   text primary key check (product_id ~ '^ID[DNQSTVW]60920$'),
  issued_at    timestamptz,
  fetched_at   timestamptz not null default now(),
  station_count integer not null default 0 check (station_count >= 0),
  stations     jsonb not null default '[]'::jsonb
);

alter table public.bom_snapshots enable row level security;

comment on table public.bom_snapshots is
  'Cached BOM state observation products. Written only by the server (service_role); no policies, so no client can read or write it.';

-- ---------------------------------------------------------------------------
-- Review-screen warnings (brief §4).
--
-- Distinct from app.entry_blocking_gaps(): a gap stops the entry being signed,
-- a warning asks the supervisor to confirm. "A weather delay claimed on a day
-- with no recorded rainfall" is the one the brief calls out — the supervisor
-- may well be right, the gauge may be kilometres away, so this is a question,
-- not a veto.
-- ---------------------------------------------------------------------------
create or replace function app.entry_warnings(p_entry_id uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(warning order by warning), '{}')
  from (
    select distinct 'weather_delay_without_rainfall' as warning
      from public.delays d
      join public.weather w on w.entry_id = d.entry_id
     where d.entry_id = p_entry_id
       and d.category = 'weather'
       and w.rainfall_mm is not null
       and w.rainfall_mm = 0
    union
    select distinct 'weather_delay_without_weather_record'
      from public.delays d
     where d.entry_id = p_entry_id
       and d.category = 'weather'
       and not exists (
         select 1 from public.weather w
          where w.entry_id = p_entry_id and w.rainfall_mm is not null
       )
    union
    select distinct 'weather_station_far_from_site'
      from public.weather w
     where w.entry_id = p_entry_id
       and w.station_distance_km is not null
       and w.station_distance_km > 25
  ) g;
$$;

comment on function app.entry_warnings(uuid) is
  'Things the review screen should ask the supervisor to confirm. Unlike blocking gaps, these never prevent signing.';

grant execute on function app.entry_warnings(uuid) to authenticated, service_role;
