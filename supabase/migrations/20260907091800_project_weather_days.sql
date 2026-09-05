-- ---------------------------------------------------------------------------
-- The week's weather belongs to the site, not to the diary.
--
-- Until now a reading only existed where an entry did: `public.weather` hangs
-- off `entry_id`. A day nobody wrote up — a Sunday, a rained-off day, a day the
-- supervisor forgot — had no reading at all, and the Today screen showed a dash
-- where a claim would later want a number. The Bureau publishes a daily climate
-- table per station (max, min, rain to 9am, average wind) on the same anonymous
-- FTP the observations come from, so the site can carry one reading per day
-- regardless of whether a diary was kept.
--
-- This is a glance table and a fill for nulls. It never overwrites a reading a
-- supervisor typed into a diary (source = 'manual'), it never touches a signed
-- entry, and it is not part of the content hash: the signed docket remains the
-- record; this is what the office looks at on Monday.
-- ---------------------------------------------------------------------------

create table public.project_weather_days (
  project_id      uuid not null references public.projects(id) on delete cascade,
  day             date not null,
  temp_max        numeric(4,1),
  temp_min        numeric(4,1),
  -- Rain in the 24 hours from 9am on `day` (the Bureau's convention for the
  -- site day), or the running total since 9am while the day is still going.
  rainfall_mm     numeric(6,1) check (rainfall_mm is null or rainfall_mm >= 0),
  wind_dir        text,
  wind_kmh        numeric(5,1) check (wind_kmh is null or wind_kmh >= 0),
  -- 'bom_daily' once the Bureau's daily table has finalised the day;
  -- 'bom_obs' while it is being built from live observations.
  source          text not null check (source in ('bom_daily', 'bom_obs')),
  station_id      text,
  station_name    text,
  fetched_at      timestamptz not null default now(),
  primary key (project_id, day)
);

comment on table public.project_weather_days is
  'One Bureau of Meteorology reading per project per day, kept whether or not a diary entry exists. Written only by the server; a glance, not the record.';
comment on column public.project_weather_days.rainfall_mm is
  'mm in the 24 hours from 09:00 local on `day` (bom_daily), or since 09:00 so far (bom_obs).';

alter table public.project_weather_days enable row level security;

create policy project_weather_days_select_member on public.project_weather_days
  for select to authenticated using (app.is_project_member(project_id));

grant select on public.project_weather_days to authenticated;
grant all on public.project_weather_days to service_role;
