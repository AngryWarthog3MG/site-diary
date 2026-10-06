-- ============================================================================
-- Hours per person on a daywork (README R129).
--
-- "Add hours in the dayworks tab" — and when asked, hours per person. A
-- daywork carried one Hours box and a free-text Labour line, and the record
-- showed what that gives: "Matt/evan, 18 hours", "2x Marcus Hayden", a dozen
-- items with no hours at all. What the client is billed, and what the sign-off
-- sheet has to say, is each person's hours on each item.
--
-- dayworks.labour_rows: [{ "person_name", "hours" }, …], the people on the
-- daywork and their own hours (null when not stated — never a share of a
-- total). When every person has hours, the daywork's hours are their sum, set
-- at save like labour's hours from its clocks. The free-text labour column
-- stays for what was said and for every daywork recorded before today.
--
-- The hash: a key only where the rows exist, so every daywork signed before
-- this column still verifies (the dayworks and notes pattern).
-- ============================================================================

alter table public.dayworks
  add column labour_rows jsonb check (labour_rows is null or jsonb_typeof(labour_rows) = 'array');
comment on column public.dayworks.labour_rows is
  'The people on the daywork and each one''s hours (README R129): [{person_name, hours|null}]. Null on rows recorded before the column.';

CREATE OR REPLACE FUNCTION app.canonical_entry_json(p_entry entries)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET "TimeZone" TO 'UTC'
 SET "DateStyle" TO 'ISO, YMD'
 SET extra_float_digits TO '1'
AS $function$
  select jsonb_build_object(
    'entry_no',            p_entry.entry_no,
    'project_id',          p_entry.project_id,
    'entry_date',          to_char(p_entry.entry_date, 'YYYY-MM-DD'),
    'author_id',           p_entry.author_id,
    'supersedes_entry_id', p_entry.supersedes_entry_id,
    'audio_url',           p_entry.audio_url,
    'transcript_raw',      p_entry.transcript_raw,

    'audio', (
      select coalesce(jsonb_agg(j order by j::text), '[]'::jsonb)
        from (select to_jsonb(t)
                       - 'id' - 'entry_id' - 'created_at'
                       - 'transcript_status' - 'transcript_error'
                       - 'transcribed_at' - 'client_ref' as j
                from public.entry_audio t where t.entry_id = p_entry.id) q
    ),
    'sections', (
      select coalesce(jsonb_agg(j order by j::text), '[]'::jsonb)
        from (select to_jsonb(s) - 'entry_id' as j
                from public.entry_sections s where s.entry_id = p_entry.id) q
    ),
    'labour', (
      select coalesce(jsonb_agg(j order by j::text), '[]'::jsonb)
        from (
          select ((to_jsonb(t) - 'id' - 'entry_id' - 'created_at')
                  - (case when t.start_time is null then 'start_time' else '' end)
                  - (case when t.finish_time is null then 'finish_time' else '' end)
                  - (case when t.break_mins is null then 'break_mins' else '' end)) as j
            from public.labour t where t.entry_id = p_entry.id
        ) q
    ),
    'plant', (
      select coalesce(jsonb_agg(j order by j::text), '[]'::jsonb)
        from (select to_jsonb(t) - 'id' - 'entry_id' - 'created_at' as j
                from public.plant t where t.entry_id = p_entry.id) q
    ),
    'work_items', (
      select coalesce(jsonb_agg(j order by j::text), '[]'::jsonb)
        from (select to_jsonb(t) - 'id' - 'entry_id' - 'created_at' as j
                from public.work_items t where t.entry_id = p_entry.id) q
    ),
    'variations', (
      select coalesce(jsonb_agg(j order by j::text), '[]'::jsonb)
        from (
          -- crew is conditional, like labour's times: a key that is absent
          -- when null keeps every entry signed before it verifying.
          select ((to_jsonb(t) - 'id' - 'entry_id' - 'created_at')
                  - (case when t.crew is null then 'crew' else '' end)
                  - (case when t.register_seq is null then 'register_seq' else '' end)
                  - (case when t.hours is null then 'hours' else '' end)) as j
            from public.variations t where t.entry_id = p_entry.id
        ) q
    ),
    'delays', (
      select coalesce(jsonb_agg(j order by j::text), '[]'::jsonb)
        from (select to_jsonb(t) - 'id' - 'entry_id' - 'created_at' as j
                from public.delays t where t.entry_id = p_entry.id) q
    ),
    'pours', (
      select coalesce(jsonb_agg(j order by j::text), '[]'::jsonb)
        from (select to_jsonb(t) - 'id' - 'entry_id' - 'created_at' as j
                from public.pours t where t.entry_id = p_entry.id) q
    ),
    'quantities', (
      select coalesce(jsonb_agg(j order by j::text), '[]'::jsonb)
        from (select to_jsonb(t) - 'id' - 'entry_id' - 'created_at' as j
                from public.quantities t where t.entry_id = p_entry.id) q
    ),
    'photos', (
      select coalesce(jsonb_agg(j order by j::text), '[]'::jsonb)
        from (
          select case
                   when t.category is null then
                     to_jsonb(t) - 'id' - 'entry_id' - 'created_at' - 'category'
                   else
                     to_jsonb(t) - 'id' - 'entry_id' - 'created_at'
                 end as j
            from public.photos t where t.entry_id = p_entry.id
        ) q
    ),
    'weather', (
      select coalesce(
               (select to_jsonb(w) - 'entry_id' - 'created_at'
                  from public.weather w where w.entry_id = p_entry.id),
               'null'::jsonb)
    )
  )
  || case
       when p_entry.notes is not null and length(btrim(p_entry.notes)) > 0
       then jsonb_build_object('notes', p_entry.notes)
       else '{}'::jsonb
     end
  -- Conditional, exactly like notes: adding the key unconditionally would
  -- change the canonical JSON of every entry signed before this migration,
  -- and their stored hashes would stop verifying.
  || case
       when exists (select 1 from public.dayworks t where t.entry_id = p_entry.id)
       then jsonb_build_object('dayworks', (
              select jsonb_agg(j order by j::text)
                from (select to_jsonb(t) - 'id' - 'entry_id' - 'created_at'
                             -- The people's own hours (README R129) join the hash only where they were recorded, so
                             -- every daywork signed before the column existed still verifies.
                             - (case when t.labour_rows is null then 'labour_rows' else '' end) as j
                        from public.dayworks t where t.entry_id = p_entry.id) q
            ))
       else '{}'::jsonb
     end
  -- Instructions received and events outside scope (README R90): conditional
  -- like dayworks, so every entry signed before today still verifies.
  || case
       when exists (select 1 from public.site_events t where t.entry_id = p_entry.id)
       then jsonb_build_object('site_events', (
              select jsonb_agg(j order by j::text)
                from (select to_jsonb(t) - 'id' - 'entry_id' - 'created_at' as j
                        from public.site_events t where t.entry_id = p_entry.id) q
            ))
       else '{}'::jsonb
     end
  -- Drawn signatures: conditional like notes and dayworks, so entries signed
  -- before this feature keep verifying.
  || case
       when exists (select 1 from public.entry_signatures t where t.entry_id = p_entry.id)
       then jsonb_build_object('signatures', (
              select jsonb_agg(j order by j::text)
                from (select to_jsonb(t) - 'id' - 'entry_id' - 'created_at' as j
                        from public.entry_signatures t where t.entry_id = p_entry.id) q
            ))
       else '{}'::jsonb
     end;
$function$
;

CREATE OR REPLACE FUNCTION public.apply_entry_review(p_entry_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_project uuid;
  v_weather jsonb := coalesce(p_payload -> 'weather', '{}'::jsonb);
  v_has_manual_weather boolean;
  v_weather_impact text := nullif(btrim(coalesce(p_payload ->> 'weather_impact', '')), '');
begin
  if not app.can_write_entry(p_entry_id) then
    raise exception 'That entry is not an open draft of yours.'
      using errcode = 'insufficient_privilege';
  end if;

  select e.project_id into v_project from public.entries e where e.id = p_entry_id;

  update public.entries
     set notes = nullif(btrim(coalesce(p_payload ->> 'notes', '')), '')
   where id = p_entry_id;

  delete from public.labour         where entry_id = p_entry_id;
  delete from public.plant          where entry_id = p_entry_id;
  delete from public.work_items     where entry_id = p_entry_id;
  delete from public.variations     where entry_id = p_entry_id;
  delete from public.delays         where entry_id = p_entry_id;
  delete from public.pours          where entry_id = p_entry_id;
  delete from public.quantities     where entry_id = p_entry_id;
  delete from public.dayworks       where entry_id = p_entry_id;
  delete from public.site_events    where entry_id = p_entry_id;
  delete from public.photos         where entry_id = p_entry_id;
  delete from public.entry_sections where entry_id = p_entry_id;

  insert into public.labour
    (entry_id, person_name, role, area, start_time, finish_time, break_mins,
     hours, overtime_hours, source_quote, confidence)
  select p_entry_id, x.person_name, x.role, x.area, x.start_time, x.finish_time, x.break_mins,
         -- Both times present: hours are ARITHMETIC, not opinion — span minus
         -- break, rolling past midnight when the finish reads earlier.
         case
           when x.start_time is not null and x.finish_time is not null then
             round((
               (extract(epoch from (x.finish_time - x.start_time)) / 3600.0)
               + case when x.finish_time <= x.start_time then 24 else 0 end
               - coalesce(x.break_mins, 0) / 60.0
             )::numeric, 2)
           else x.hours
         end,
         x.overtime_hours, x.source_quote, x.confidence
    from jsonb_to_recordset(coalesce(p_payload -> 'labour', '[]'::jsonb)) as x(
      person_name text, role text, area text, start_time time, finish_time time,
      break_mins integer, hours numeric, overtime_hours numeric,
      source_quote text, confidence public.confidence);

  insert into public.plant
    (entry_id, item, hire_type, hours, idle_hours, supplier, source_quote, confidence)
  select p_entry_id, x.item, x.hire_type, x.hours, x.idle_hours, x.supplier,
         x.source_quote, x.confidence
    from jsonb_to_recordset(coalesce(p_payload -> 'plant', '[]'::jsonb)) as x(
      item text, hire_type public.hire_type, hours numeric, idle_hours numeric,
      supplier text, source_quote text, confidence public.confidence);

  insert into public.work_items
    (entry_id, area, description, percent_complete, source_quote, confidence)
  select p_entry_id, x.area, x.description, x.percent_complete, x.source_quote, x.confidence
    from jsonb_to_recordset(coalesce(p_payload -> 'work_items', '[]'::jsonb)) as x(
      area text, description text, percent_complete numeric,
      source_quote text, confidence public.confidence);

  insert into public.variations
    (entry_id, description, directed_by, directed_at, vr_ref, estimated_cost,
     crew, register_seq, hours, photo_urls, source_quote, confidence)
  select p_entry_id, x.description, x.directed_by, x.directed_at, x.vr_ref, x.estimated_cost,
         nullif(x.crew, '{}'), x.register_seq, x.hours, coalesce(x.photo_urls, '{}'), x.source_quote, x.confidence
    from jsonb_to_recordset(coalesce(p_payload -> 'variations', '[]'::jsonb)) as x(
      description text, directed_by text, directed_at timestamptz, vr_ref text,
      estimated_cost numeric, crew text[], register_seq integer, hours numeric, photo_urls text[],
      source_quote text, confidence public.confidence);

  insert into public.delays
    (entry_id, start_time, end_time, duration_mins, cause, personnel_affected,
     category, source_quote, confidence)
  select p_entry_id, x.start_time, x.end_time, x.duration_mins, x.cause,
         x.personnel_affected, x.category, x.source_quote, x.confidence
    from jsonb_to_recordset(coalesce(p_payload -> 'delays', '[]'::jsonb)) as x(
      start_time time, end_time time, duration_mins integer, cause text,
      personnel_affected integer, category public.delay_category,
      source_quote text, confidence public.confidence);

  insert into public.pours
    (entry_id, location, volume_m3, mix_spec, supplier, docket_nos, start_time,
     finish_time, docket_photo_urls, source_quote, confidence)
  select p_entry_id, x.location, x.volume_m3, x.mix_spec, x.supplier,
         coalesce(x.docket_nos, '{}'), x.start_time, x.finish_time,
         coalesce(x.docket_photo_urls, '{}'), x.source_quote, x.confidence
    from jsonb_to_recordset(coalesce(p_payload -> 'pours', '[]'::jsonb)) as x(
      location text, volume_m3 numeric, mix_spec text, supplier text,
      docket_nos text[], start_time time, finish_time time,
      docket_photo_urls text[], source_quote text, confidence public.confidence);

  insert into public.quantities
    (entry_id, item_type, area, quantity, unit, source_quote, confidence)
  select p_entry_id, x.item_type, x.area, x.quantity, x.unit, x.source_quote, x.confidence
    from jsonb_to_recordset(coalesce(p_payload -> 'quantities', '[]'::jsonb)) as x(
      item_type text, area text, quantity numeric, unit text,
      source_quote text, confidence public.confidence);

  insert into public.dayworks
    (entry_id, description, labour, plant, materials, hours, docket_ref,
     photo_urls, source_quote, confidence, labour_rows)
  select p_entry_id, x.description, x.labour, x.plant, x.materials,
         -- The people's hours are the daywork's hours (README R129): when every person on it has theirs, the total is
         -- their sum — arithmetic, not opinion — and a typed total is not kept over it. One person without hours
         -- leaves the total as typed, or blank: never a share of a figure nobody said.
         case
           when x.labour_rows is not null and jsonb_typeof(x.labour_rows) = 'array' and jsonb_array_length(x.labour_rows) > 0
                and not exists (select 1 from jsonb_array_elements(x.labour_rows) r where nullif(r->>'hours', '') is null)
           then (select round(sum((r->>'hours')::numeric), 2) from jsonb_array_elements(x.labour_rows) r)
           else x.hours
         end,
         x.docket_ref, coalesce(x.photo_urls, '{}'), x.source_quote, x.confidence,
         case when x.labour_rows is not null and jsonb_typeof(x.labour_rows) = 'array' and jsonb_array_length(x.labour_rows) > 0
              then (select jsonb_agg(jsonb_build_object('person_name', btrim(regexp_replace(r->>'person_name', '\s+', ' ', 'g')), 'hours', (nullif(r->>'hours', ''))::numeric) order by ord)
                      from jsonb_array_elements(x.labour_rows) with ordinality as e(r, ord)
                     where btrim(coalesce(r->>'person_name', '')) <> '')
              else null end
    from jsonb_to_recordset(coalesce(p_payload -> 'dayworks', '[]'::jsonb)) as x(
      description text, labour text, plant text, materials text, hours numeric,
      docket_ref text, photo_urls text[], source_quote text, confidence public.confidence, labour_rows jsonb);

  -- The supervisor's words about an instruction or an event, as confirmed on
  -- the review screen — never rewritten here (README R90).
  insert into public.site_events
    (entry_id, said_text, location, directed_by, occurred_time, photo_urls, source_quote, confidence)
  select p_entry_id, x.said_text, x.location, x.directed_by, x.occurred_time,
         coalesce(x.photo_urls, '{}'), x.source_quote, x.confidence
    from jsonb_to_recordset(coalesce(p_payload -> 'site_events', '[]'::jsonb)) as x(
      said_text text, location text, directed_by text, occurred_time time,
      photo_urls text[], source_quote text, confidence public.confidence)
   where length(btrim(coalesce(x.said_text, ''))) > 0;

  insert into public.photos
    (entry_id, url, caption, category, taken_at, lat, lng)
  select p_entry_id, x.url, x.caption, x.category, x.taken_at, x.lat, x.lng
    from jsonb_to_recordset(coalesce(p_payload -> 'photos', '[]'::jsonb)) as x(
      url text, caption text, category text, taken_at timestamptz,
      lat double precision, lng double precision);

  delete from public.entry_signatures where entry_id = p_entry_id;
  insert into public.entry_signatures (entry_id, role, signatory_name, image_path)
  select p_entry_id, x.role, x.signatory_name, x.image_path
    from jsonb_to_recordset(coalesce(p_payload -> 'signatures', '[]'::jsonb)) as x(
      role text, signatory_name text, image_path text)
   where x.role in ('supervisor', 'client')
     and length(btrim(coalesce(x.signatory_name, ''))) > 0
     and length(btrim(coalesce(x.image_path, ''))) > 0;

  insert into public.entry_sections (entry_id, section, state, note)
  select p_entry_id, x.section, x.state, x.note
    from jsonb_to_recordset(coalesce(p_payload -> 'sections', '[]'::jsonb)) as x(
      section public.entry_section, state public.section_state, note text);

  -- A manual reading exists only when the payload carries a weather object
  -- with an actual value in it. A payload without the key leaves the stored
  -- row alone — a BOM observation round-tripping through the review screen
  -- must never come back relabelled 'manual' with its provenance erased.
  v_has_manual_weather :=
    (p_payload ? 'weather') and (
      (v_weather ? 'temp_max' and jsonb_typeof(v_weather -> 'temp_max') = 'number') or
      (v_weather ? 'temp_min' and jsonb_typeof(v_weather -> 'temp_min') = 'number') or
      (v_weather ? 'rainfall_mm' and jsonb_typeof(v_weather -> 'rainfall_mm') = 'number') or
      (v_weather ? 'wind_kmh' and jsonb_typeof(v_weather -> 'wind_kmh') = 'number') or
      nullif(btrim(coalesce(v_weather ->> 'wind_dir', '')), '') is not null
    );

  if v_has_manual_weather then
    insert into public.weather
      (entry_id, source, temp_max, temp_min, rainfall_mm, wind_dir, wind_kmh,
       observed_impact, station_id, station_name, station_distance_km,
       observed_from, observed_to, fetched_at)
    values
      (p_entry_id, 'manual',
       nullif(v_weather ->> 'temp_max', '')::numeric,
       nullif(v_weather ->> 'temp_min', '')::numeric,
       nullif(v_weather ->> 'rainfall_mm', '')::numeric,
       nullif(btrim(coalesce(v_weather ->> 'wind_dir', '')), ''),
       nullif(v_weather ->> 'wind_kmh', '')::numeric,
       v_weather_impact, null, null, null, null, null, null)
    on conflict (entry_id) do update set
      source = 'manual',
      temp_max = excluded.temp_max,
      temp_min = excluded.temp_min,
      rainfall_mm = excluded.rainfall_mm,
      wind_dir = excluded.wind_dir,
      wind_kmh = excluded.wind_kmh,
      observed_impact = excluded.observed_impact,
      station_id = null,
      station_name = null,
      station_distance_km = null,
      observed_from = null,
      observed_to = null,
      fetched_at = null;
  elsif v_weather_impact is not null then
    insert into public.weather (entry_id, source, observed_impact)
    values (p_entry_id, 'manual', v_weather_impact)
    on conflict (entry_id) do update set observed_impact = excluded.observed_impact;
  else
    update public.weather set observed_impact = null where entry_id = p_entry_id;
  end if;

  return public.entry_review_state(p_entry_id);
end;
$function$
;

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

create or replace view diary.dayworks with (security_invoker = true) as
select d.entry_no, d.entry_date, d.project_id, d.project_name,
       dw.description, dw.labour, dw.plant, dw.materials, dw.hours, dw.docket_ref,
       dw.id as daywork_id,
       -- Appended, as a replaced view's columns must be.
       dw.labour_rows
from public.dayworks dw join diary.entries d on d.entry_id = dw.entry_id;
