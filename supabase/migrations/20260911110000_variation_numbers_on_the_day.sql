-- ============================================================================
-- The register number is the day's reference.
--
-- The owner's model: the register holds V-001 to V-050 for the job; on a day,
-- the supervisor picks the number the work belongs to; the register collates
-- the days, the crew, the photos, the client's reference, the value and the
-- status. The day carries only the number.
--
-- So: variations.register_seq (conditional in the hash, absent when null, so
-- every entry signed before today still verifies); a variation is registered
-- by its number and never any more by matching words or a client reference;
-- the signing gap asks for the number, not a VR reference; and recording a
-- register item on another day stamps that day's row with the number.
-- ============================================================================

alter table public.variations add column if not exists register_seq integer
  check (register_seq is null or (register_seq >= 1 and register_seq <= 999));

-- Rows on open days already linked to a register item carry its number from
-- today. Rows on signed days are immutable — the trigger refuses the update,
-- and setting the column would change the canonical JSON and so the hash of
-- an entry already signed. Those rows keep their number through the link,
-- which every reader falls back to (variation_number below; diary.variations).
update public.variations v
   set register_seq = r.seq
  from public.variation_register_links l
  join public.variation_register r on r.id = l.register_id
 where l.variation_id = v.id and v.register_seq is null
   and exists (select 1 from public.entries e where e.id = v.entry_id and e.status <> 'signed');

-- The number a variation carries: what the day recorded, else the register
-- item it was linked to before numbers lived on the day. A PostgREST computed
-- field: select('*, variation_number') on variations.
create or replace function public.variation_number(v public.variations)
returns integer
language sql stable
set search_path = ''
as $$
  select coalesce(v.register_seq,
    (select r.seq from public.variation_register_links l
       join public.variation_register r on r.id = l.register_id
      where l.variation_id = v.id limit 1));
$$;
grant execute on function public.variation_number(public.variations) to authenticated, service_role;

create or replace function app.canonical_entry_json(p_entry public.entries)
returns jsonb
language sql
stable
security definer
set search_path = ''
set timezone = 'UTC'
set datestyle = 'ISO, YMD'
set extra_float_digits = 1
as $$
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
                  - (case when t.register_seq is null then 'register_seq' else '' end)) as j
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
                from (select to_jsonb(t) - 'id' - 'entry_id' - 'created_at' as j
                        from public.dayworks t where t.entry_id = p_entry.id) q
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
$$;

create or replace function public.apply_entry_review(p_entry_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
     crew, register_seq, photo_urls, source_quote, confidence)
  select p_entry_id, x.description, x.directed_by, x.directed_at, x.vr_ref, x.estimated_cost,
         nullif(x.crew, '{}'), x.register_seq, coalesce(x.photo_urls, '{}'), x.source_quote, x.confidence
    from jsonb_to_recordset(coalesce(p_payload -> 'variations', '[]'::jsonb)) as x(
      description text, directed_by text, directed_at timestamptz, vr_ref text,
      estimated_cost numeric, crew text[], register_seq integer, photo_urls text[],
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
     photo_urls, source_quote, confidence)
  select p_entry_id, x.description, x.labour, x.plant, x.materials, x.hours,
         x.docket_ref, coalesce(x.photo_urls, '{}'), x.source_quote, x.confidence
    from jsonb_to_recordset(coalesce(p_payload -> 'dayworks', '[]'::jsonb)) as x(
      description text, labour text, plant text, materials text, hours numeric,
      docket_ref text, photo_urls text[], source_quote text, confidence public.confidence);

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
$$;

-- A number chosen on the day is what registers a variation. Nothing else does.
create or replace function app.register_variation_row(p_variation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v       record;
  v_entry record;
  v_reg   uuid;
begin
  select * into v from public.variations where id = p_variation_id;
  if not found or v.register_seq is null then return; end if;
  select id, project_id, entry_date into v_entry from public.entries where id = v.entry_id;
  if not found then return; end if;

  select r.id into v_reg from public.variation_register r
   where r.project_id = v_entry.project_id and r.seq = v.register_seq;
  if v_reg is null then
    -- First day on this number: the item is born with the day's words as its
    -- title and the day as when it was raised. Both are edited on the register.
    insert into public.variation_register (project_id, seq, title, raised_on)
    values (v_entry.project_id, v.register_seq, btrim(v.description), v_entry.entry_date)
    returning id into v_reg;
    insert into public.variation_status_events (register_id, status, note)
    values (v_reg, 'raised', 'Raised in the diary on ' || to_char(v_entry.entry_date, 'DD/MM/YYYY'));
  else
    update public.variation_register r set raised_on = least(r.raised_on, v_entry.entry_date) where r.id = v_reg;
  end if;

  insert into public.variation_register_links (variation_id, register_id)
  values (v.id, v_reg)
  on conflict (variation_id) do update set register_id = excluded.register_id;
end;
$$;

-- An auto-issued number (a register item made without a day) takes the next
-- unused number rather than a counter that the day's picks can overtake.
create or replace function app.variation_register_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.seq is null then
    select coalesce(max(r.seq), 0) + 1 into new.seq
      from public.variation_register r where r.project_id = new.project_id;
  end if;
  update public.projects p
     set next_variation_seq = greatest(p.next_variation_seq, new.seq + 1)
   where p.id = new.project_id;
  return new;
end;
$$;

create or replace function app.entry_blocking_gaps(p_entry_id uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(gap order by gap), '{}')
  from (
    select distinct 'variation_missing_number' as gap
      from public.variations v
     where v.entry_id = p_entry_id
       and v.register_seq is null
    union
    select distinct 'pour_missing_volume_m3'
      from public.pours p
     where p.entry_id = p_entry_id
       and p.volume_m3 is null
    union
    select distinct 'delay_missing_times'
      from public.delays d
     where d.entry_id = p_entry_id
       and (d.start_time is null or d.end_time is null)
  ) g;
$$;

create or replace function public.record_variation_on_day(p_register_id uuid, p_entry_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item  public.variation_register;
  v_entry public.entries;
  v_new   uuid;
begin
  select * into v_item from public.variation_register where id = p_register_id;
  if not found or not app.is_project_member(v_item.project_id) then
    raise exception 'That variation is not on one of your projects.';
  end if;
  select * into v_entry from public.entries where id = p_entry_id;
  if not found or v_entry.project_id <> v_item.project_id then
    raise exception 'That day is not on this project.';
  end if;
  if v_entry.status = 'signed' then
    raise exception 'That day is signed; record the variation on a correction instead.';
  end if;
  if not app.can_write_entry(p_entry_id) then
    raise exception 'That day is not an open draft you can write to.';
  end if;
  if exists (
    select 1 from public.variation_register_links l
      join public.variations v on v.id = l.variation_id
     where l.register_id = p_register_id and v.entry_id = p_entry_id
  ) then
    raise exception 'That day already records this variation.';
  end if;
  insert into public.variations (entry_id, description, register_seq, source_quote)
  values (p_entry_id, v_item.title, v_item.seq, null)
  returning id into v_new;
  insert into public.entry_sections (entry_id, section, state)
  values (p_entry_id, 'variations', 'captured')
  on conflict (entry_id, section) do update set state = 'captured';
  return v_new;
end;
$$;

create or replace view diary.variations with (security_invoker = true) as
select d.entry_no, d.entry_date, d.project_id, d.project_name,
       v.description, v.directed_by, v.directed_at, v.vr_ref, v.estimated_cost,
       coalesce(array_length(v.photo_urls, 1), 0) as photo_count,
       v.id as variation_id,
       v.crew,
       public.variation_number(v) as register_seq
from public.variations v join diary.entries d on d.entry_id = v.entry_id;
grant select on diary.variations to authenticated, service_role;
