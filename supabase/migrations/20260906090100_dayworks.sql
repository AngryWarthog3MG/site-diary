-- ============================================================================
-- 20260906090100_dayworks.sql
-- Dayworks and daily progress-photo category.
-- ============================================================================

create table public.dayworks (
  id           uuid primary key default gen_random_uuid(),
  entry_id     uuid not null references public.entries (id) on delete cascade,
  description  text not null check (length(btrim(description)) > 0),
  labour       text,
  plant        text,
  materials    text,
  hours        numeric(6,2) check (hours >= 0),
  docket_ref   text,
  photo_urls   text[] not null default '{}',
  source_quote text,
  confidence   public.confidence,
  created_at   timestamptz not null default now()
);

create index dayworks_entry_idx on public.dayworks (entry_id);

alter table public.dayworks enable row level security;

create policy dayworks_select_member on public.dayworks
  for select to authenticated
  using (app.can_read_entry(entry_id));

create policy dayworks_insert_own_draft on public.dayworks
  for insert to authenticated
  with check (app.can_write_entry(entry_id));

create policy dayworks_update_own_draft on public.dayworks
  for update to authenticated
  using (app.can_write_entry(entry_id))
  with check (app.can_write_entry(entry_id));

create policy dayworks_delete_own_draft on public.dayworks
  for delete to authenticated
  using (app.can_write_entry(entry_id));

create trigger dayworks_enforce_immutable
  before insert or update or delete on public.dayworks
  for each row execute function app.child_enforce_immutable();

alter table public.photos
  drop constraint if exists photos_category_check;

alter table public.photos
  add constraint photos_category_check
  check (category is null or category in ('progress', 'works', 'delay', 'variation', 'pour', 'safety', 'general'));

comment on table public.dayworks is
  'Dayworks/day-labour items confirmed by the supervisor for an unsigned draft and frozen at signing.';

comment on column public.photos.category is
  'Supervisor label for general site photos: progress, works, delay, variation, pour, safety or general.';

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
        from (select to_jsonb(t) - 'id' - 'entry_id' - 'created_at' as j
                from public.labour t where t.entry_id = p_entry.id) q
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
        from (select to_jsonb(t) - 'id' - 'entry_id' - 'created_at' as j
                from public.variations t where t.entry_id = p_entry.id) q
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
    (entry_id, person_name, role, area, hours, overtime_hours, source_quote, confidence)
  select p_entry_id, x.person_name, x.role, x.area, x.hours, x.overtime_hours,
         x.source_quote, x.confidence
    from jsonb_to_recordset(coalesce(p_payload -> 'labour', '[]'::jsonb)) as x(
      person_name text, role text, area text, hours numeric, overtime_hours numeric,
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
     photo_urls, source_quote, confidence)
  select p_entry_id, x.description, x.directed_by, x.directed_at, x.vr_ref, x.estimated_cost,
         coalesce(x.photo_urls, '{}'), x.source_quote, x.confidence
    from jsonb_to_recordset(coalesce(p_payload -> 'variations', '[]'::jsonb)) as x(
      description text, directed_by text, directed_at timestamptz, vr_ref text,
      estimated_cost numeric, photo_urls text[], source_quote text,
      confidence public.confidence);

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

create or replace view diary.dayworks with (security_invoker = true) as
select d.entry_no, d.entry_date, d.project_id, d.project_name,
       dw.description, dw.labour, dw.plant, dw.materials, dw.hours, dw.docket_ref
from public.dayworks dw join diary.entries d on d.entry_id = dw.entry_id;

grant select on diary.dayworks to authenticated, service_role;

create or replace function public.diary_search(
  p_query      text,
  p_project_id uuid default null,
  p_limit      integer default 20
)
returns table (
  entry_no     text,
  entry_date   date,
  project_name text,
  field        text,
  snippet      text,
  rank         real
)
language sql
stable
set search_path = ''
as $$
  with q as (select websearch_to_tsquery('english', p_query) as tsq)
  select * from (
    select d.entry_no, d.entry_date, d.project_name, 'transcript'::text as field,
           ts_headline('english', d.transcript_raw, q.tsq,
                       'MaxFragments=2, MinWords=8, MaxWords=26, StartSel=<<, StopSel=>>') as snippet,
           ts_rank(to_tsvector('english', coalesce(d.transcript_raw, '')), q.tsq) as rank
      from diary.entries d, q
     where d.transcript_raw is not null
       and to_tsvector('english', d.transcript_raw) @@ q.tsq
       and (p_project_id is null or d.project_id = p_project_id)

    union all
    select w.entry_no, w.entry_date, w.project_name, 'works completed',
           ts_headline('english', w.description, q.tsq,
                       'MaxFragments=1, MinWords=6, MaxWords=24, StartSel=<<, StopSel=>>'),
           ts_rank(to_tsvector('english', w.description), q.tsq)
      from diary.work_items w, q
     where to_tsvector('english', w.description) @@ q.tsq
       and (p_project_id is null or w.project_id = p_project_id)

    union all
    select v.entry_no, v.entry_date, v.project_name, 'variation',
           ts_headline('english', v.description, q.tsq,
                       'MaxFragments=1, MinWords=6, MaxWords=24, StartSel=<<, StopSel=>>'),
           ts_rank(to_tsvector('english', v.description), q.tsq)
      from diary.variations v, q
     where to_tsvector('english', v.description) @@ q.tsq
       and (p_project_id is null or v.project_id = p_project_id)

    union all
    select dw.entry_no, dw.entry_date, dw.project_name, 'dayworks',
           ts_headline('english', concat_ws(' ', dw.description, dw.labour, dw.plant, dw.materials, dw.docket_ref), q.tsq,
                       'MaxFragments=1, MinWords=6, MaxWords=24, StartSel=<<, StopSel=>>'),
           ts_rank(to_tsvector('english', concat_ws(' ', dw.description, dw.labour, dw.plant, dw.materials, dw.docket_ref)), q.tsq)
      from diary.dayworks dw, q
     where to_tsvector('english', concat_ws(' ', dw.description, dw.labour, dw.plant, dw.materials, dw.docket_ref)) @@ q.tsq
       and (p_project_id is null or dw.project_id = p_project_id)

    union all
    select dl.entry_no, dl.entry_date, dl.project_name, 'delay',
           ts_headline('english', dl.cause, q.tsq,
                       'MaxFragments=1, MinWords=6, MaxWords=24, StartSel=<<, StopSel=>>'),
           ts_rank(to_tsvector('english', dl.cause), q.tsq)
      from diary.delays dl, q
     where dl.cause is not null
       and to_tsvector('english', dl.cause) @@ q.tsq
       and (p_project_id is null or dl.project_id = p_project_id)
  ) hits
  order by hits.rank desc, hits.entry_date desc, hits.entry_no
  limit least(greatest(coalesce(p_limit, 20), 1), 100);
$$;
