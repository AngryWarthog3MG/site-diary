-- ============================================================================
-- Instructions received, and anything outside our scope (README R90).
--
-- The diary's seventh section. What the head contractor directed, what the
-- crew was asked to do that may be extra, and whatever stopped or slowed the
-- work from outside the crew's control — in the supervisor's own words. It is
-- the record a notice stands on, and the record a claim stands on months later
-- when the notice is argued over.
--
-- A site event is a child of the day like a daywork: proposed by extraction,
-- confirmed on the review screen, rewritten on every save, frozen at signing,
-- and part of the content hash — conditionally, so every entry signed before
-- today still verifies. `said_text` is the supervisor's words as confirmed;
-- the extraction is told never to tidy them and the review screen shows the
-- source quote beside them.
--
-- Notices are the office's: drafted from a signed event, edited, and SENT BY A
-- PERSON — the app records that it went, and how, and never sends one itself.
-- Supervisors never read them. Once sent, a notice is frozen but for voiding.
-- ============================================================================

alter type public.entry_section add value if not exists 'site_events';

create table public.site_events (
  id             uuid primary key default gen_random_uuid(),
  entry_id       uuid not null references public.entries (id) on delete cascade,
  said_text      text not null check (length(btrim(said_text)) > 0),
  location       text,
  directed_by    text,
  occurred_time  time,
  photo_urls     text[] not null default '{}',
  source_quote   text,
  confidence     public.confidence,
  created_at     timestamptz not null default now()
);
create index site_events_entry_idx on public.site_events (entry_id);
alter table public.site_events enable row level security;
create policy site_events_select_member on public.site_events
  for select to authenticated using (app.can_read_entry(entry_id));
create policy site_events_insert_own_draft on public.site_events
  for insert to authenticated with check (app.can_write_entry(entry_id));
create policy site_events_update_own_draft on public.site_events
  for update to authenticated using (app.can_write_entry(entry_id)) with check (app.can_write_entry(entry_id));
create policy site_events_delete_own_draft on public.site_events
  for delete to authenticated using (app.can_write_entry(entry_id));
-- The labourer reads none of the record (migration 20260915140000).
create policy site_events_reads_record on public.site_events as restrictive for select to authenticated
  using (exists (select 1 from public.entries e where e.id = entry_id and app.reads_record(e.project_id)));
create trigger site_events_enforce_immutable
  before insert or update or delete on public.site_events
  for each row execute function app.child_enforce_immutable();
grant select, insert, update, delete on public.site_events to authenticated;
grant all on public.site_events to service_role;
comment on table public.site_events is
  'Instructions received and events outside scope, in the supervisor''s words, confirmed on the day. Frozen at signing. The record a notice stands on.';

-- ---------------------------------------------------------------------------
-- The office: project managers and admins. Supervisors keep the screens they
-- have (Mitchell, 2026-09-21); the NEW money-and-risk tables are office-only.
-- ---------------------------------------------------------------------------
create or replace function app.is_office(p_project uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.project_members pm
     where pm.project_id = p_project and pm.user_id = (select auth.uid()) and pm.role::text in ('pm', 'admin')
  );
$$;
grant execute on function app.is_office(uuid) to authenticated;

create or replace function app.is_any_office()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.project_members pm where pm.user_id = (select auth.uid()) and pm.role::text in ('pm', 'admin'));
$$;
grant execute on function app.is_any_office() to authenticated;

/** The signed day an event belongs to, or null while it is still a draft. */
create or replace function app.site_event_signed_project(p_event uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select e.project_id from public.site_events s join public.entries e on e.id = s.entry_id
   where s.id = p_event and e.status = 'signed';
$$;

-- ---------------------------------------------------------------------------
-- Notices. Numbered per job. Drafted from a signed event or raised outright.
-- ---------------------------------------------------------------------------
create table public.notices (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid not null references public.projects (id) on delete restrict,
  seq                integer not null,
  site_event_id      uuid references public.site_events (id) on delete restrict,
  -- Form 1.
  what_happened      text not null default '',
  why_outside_scope  text not null default '',
  work_affected      text not null default '',
  what_we_need       text not null default '',
  evidence           text not null default '',
  -- Sent by a person, recorded here. Never sent by the app.
  sent_at            timestamptz,
  sent_how           text,
  sent_to            text,
  reference          text,
  voided_at          timestamptz,
  void_reason        text,
  created_by         uuid references auth.users (id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (project_id, seq),
  constraint notices_sent_needs_how check (sent_at is null or length(btrim(coalesce(sent_how, ''))) > 0),
  constraint notices_void_needs_reason check (voided_at is null or length(btrim(coalesce(void_reason, ''))) > 0)
);
create unique index notices_one_per_event_idx on public.notices (site_event_id) where site_event_id is not null and voided_at is null;
create index notices_project_idx on public.notices (project_id, sent_at, created_at);

create or replace function app.notices_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtext('notices:' || new.project_id::text));
  select coalesce(max(n.seq), 0) + 1 into new.seq from public.notices n where n.project_id = new.project_id;
  if new.site_event_id is not null and app.site_event_signed_project(new.site_event_id) is distinct from new.project_id then
    raise exception 'A notice is drafted from an event on a SIGNED day of this job.' using errcode = 'check_violation';
  end if;
  new.created_by := coalesce((select auth.uid()), new.created_by);
  new.created_at := now(); new.updated_at := now();
  new.sent_at := null; new.sent_how := null; new.sent_to := null; new.voided_at := null; new.void_reason := null;
  return new;
end; $$;
create trigger a_notices_before_insert before insert on public.notices
  for each row execute function app.notices_before_insert();

create or replace function app.notices_before_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  if new.project_id is distinct from old.project_id or new.seq is distinct from old.seq
     or new.site_event_id is distinct from old.site_event_id or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'A notice stays what it was raised as.' using errcode = 'check_violation';
  end if;
  if old.voided_at is not null then
    raise exception 'A voided notice is not changed; raise a new one.' using errcode = 'check_violation';
  end if;
  -- Sent: frozen but for voiding.
  if old.sent_at is not null then
    if new.voided_at is not null and old.voided_at is null then
      new.what_happened := old.what_happened; new.why_outside_scope := old.why_outside_scope;
      new.work_affected := old.work_affected; new.what_we_need := old.what_we_need; new.evidence := old.evidence;
      new.sent_at := old.sent_at; new.sent_how := old.sent_how; new.sent_to := old.sent_to; new.reference := old.reference;
      return new;
    end if;
    raise exception 'A sent notice is not changed; void it and raise a new one.' using errcode = 'check_violation';
  end if;
  if new.sent_at is not null and new.sent_at > now() + interval '5 minutes' then
    raise exception 'Record a notice once it has been sent.' using errcode = 'check_violation';
  end if;
  return new;
end; $$;
create trigger a_notices_before_update before update on public.notices
  for each row execute function app.notices_before_update();
create trigger a_notices_no_delete before delete on public.notices
  for each row execute function app.frozen_row();

alter table public.notices enable row level security;
create policy notices_office_select on public.notices for select to authenticated using (app.is_office(project_id));
create policy notices_office_insert on public.notices for insert to authenticated with check (app.is_office(project_id));
create policy notices_office_update on public.notices for update to authenticated using (app.is_office(project_id)) with check (app.is_office(project_id));
grant select, insert, update on public.notices to authenticated;
grant all on public.notices to service_role;
comment on table public.notices is
  'A notice to the head contractor, drafted from a signed site event, sent by a person and recorded here. Office-only. Frozen once sent.';

-- An event the office looked at and decided needs no notice — with the reason, so the decision is on the record.
create table public.site_event_triage (
  site_event_id  uuid primary key references public.site_events (id) on delete restrict,
  project_id     uuid not null references public.projects (id) on delete restrict,
  reason         text not null check (length(btrim(reason)) > 0),
  decided_by     uuid references auth.users (id),
  decided_at     timestamptz not null default now()
);
create or replace function app.site_event_triage_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if app.site_event_signed_project(new.site_event_id) is distinct from new.project_id then
    raise exception 'Only an event on a SIGNED day of this job is triaged.' using errcode = 'check_violation';
  end if;
  new.reason := regexp_replace(btrim(new.reason), '\s+', ' ', 'g');
  new.decided_by := coalesce((select auth.uid()), new.decided_by);
  new.decided_at := now();
  return new;
end; $$;
create trigger a_site_event_triage_before_insert before insert on public.site_event_triage
  for each row execute function app.site_event_triage_before_insert();
create trigger a_site_event_triage_frozen before update or delete on public.site_event_triage
  for each row execute function app.frozen_row();
alter table public.site_event_triage enable row level security;
create policy site_event_triage_office_select on public.site_event_triage for select to authenticated using (app.is_office(project_id));
create policy site_event_triage_office_insert on public.site_event_triage for insert to authenticated with check (app.is_office(project_id));
grant select, insert on public.site_event_triage to authenticated;
grant all on public.site_event_triage to service_role;

-- The Ask view, like every other section.
create or replace view diary.site_events with (security_invoker = true) as
select d.entry_no, d.entry_date, d.project_id, d.project_name,
       s.said_text, s.location, s.directed_by, s.occurred_time,
       coalesce(array_length(s.photo_urls, 1), 0) as photo_count,
       s.id as site_event_id
  from public.site_events s join diary.entries d on d.entry_id = s.entry_id;
grant select on diary.site_events to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The hash and the review apply, with the new section — the live definitions
-- with the one addition each, so nothing else moves.
-- ---------------------------------------------------------------------------
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
                from (select to_jsonb(t) - 'id' - 'entry_id' - 'created_at' as j
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
     photo_urls, source_quote, confidence)
  select p_entry_id, x.description, x.labour, x.plant, x.materials, x.hours,
         x.docket_ref, coalesce(x.photo_urls, '{}'), x.source_quote, x.confidence
    from jsonb_to_recordset(coalesce(p_payload -> 'dayworks', '[]'::jsonb)) as x(
      description text, labour text, plant text, materials text, hours numeric,
      docket_ref text, photo_urls text[], source_quote text, confidence public.confidence);

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
