-- Confirming the gate's clocks (README R171).
--
-- Evan's Thursday on Kalgoorlie carried the gate's clocks, 06:30 to 18:30, which were right; the day was signed and
-- corrected once more, and still the timesheet left his hours out (R135: the gate's clocks are not hours for pay until
-- a clock is edited by hand) because nothing on the row needed changing. The screen now has "Confirm clocks" on such a
-- row, and this warning asks about every row still carrying the gate's mark before the day is signed. Same body as
-- 20261006120000 with one union added; the TypeScript half is reviewQualityWarnings.

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
    union
    -- A person on a daywork with no hours of their own (README R129): asked about, never blocked, never shared out.
    select distinct 'daywork_labour_missing_hours'
      from public.dayworks dw, jsonb_array_elements(dw.labour_rows) r
     where dw.entry_id = p_entry_id
       and nullif(r->>'hours', '') is null
    union
    -- A labour row still carrying the gate's clocks (README R135, R171): asked about before signing, never blocked.
    select distinct 'labour_gate_unconfirmed'
      from public.labour l
     where l.entry_id = p_entry_id
       and l.source_quote like 'Gate:%'
    union
    select distinct 'plant_without_prestart'
      from public.plant pl
      join public.entries e on e.id = pl.entry_id
     where pl.entry_id = p_entry_id
       and not exists (
         select 1
           from public.plant_prestarts pp
           join public.plant_register pr on pr.id = pp.plant_id
          where pp.project_id = e.project_id
            and pp.prestart_date = e.entry_date
            and pp.completed_at is not null
            and (pr.name ilike '%' || pl.item || '%' or pl.item ilike '%' || pr.name || '%')
       )
  ) g;
$$;
