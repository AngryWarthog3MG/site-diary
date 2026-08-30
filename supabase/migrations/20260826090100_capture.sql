-- ============================================================================
-- 20260826090100_capture.sql
-- Step 2: audio segments, transcription state, and the per-project keyword
-- list that boosts transcription accuracy (brief §4).
--
-- Why entry_audio rather than the single entries.audio_url in §3: the offline
-- queue can hold several recordings for one day before it ever reaches a
-- network, and a supervisor who gets interrupted records twice. Forcing one
-- blob per entry would silently drop the rest. entries.audio_url and
-- entries.transcript_raw survive unchanged as the §3 contract — they are now
-- derived from the segments by trigger, so the PDF and the hash see exactly
-- what they saw before.
-- ============================================================================

create type public.transcript_status as enum ('pending', 'processing', 'done', 'failed');

create table public.entry_audio (
  id                  uuid primary key default gen_random_uuid(),
  entry_id            uuid not null references public.entries (id) on delete cascade,

  -- Order within the entry. Assigned by trigger.
  seq                 integer not null,

  -- Path within the entry-audio bucket: {project_id}/{entry_id}/{file}
  url                 text not null check (length(btrim(url)) > 0),
  mime_type           text,
  duration_ms         integer check (duration_ms >= 0),
  recorded_at         timestamptz,

  transcript          text,
  transcript_status   public.transcript_status not null default 'pending',
  transcript_provider text,
  transcript_error    text,
  transcribed_at      timestamptz,

  -- The offline queue's local id for this blob. Makes sync idempotent: a phone
  -- that uploads twice because it lost the response the first time does not
  -- create a second segment.
  client_ref          text,

  created_at          timestamptz not null default now(),

  unique (entry_id, seq),
  unique (entry_id, client_ref)
);

create index entry_audio_entry_idx on public.entry_audio (entry_id);
create index entry_audio_pending_idx on public.entry_audio (entry_id)
  where transcript_status in ('pending', 'processing');

-- ---------------------------------------------------------------------------
-- seq allocation
-- ---------------------------------------------------------------------------
create or replace function app.assign_audio_seq()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.seq is null then
    select coalesce(max(a.seq), 0) + 1
      into new.seq
      from public.entry_audio a
     where a.entry_id = new.entry_id;
  end if;
  return new;
end;
$$;

create trigger entry_audio_assign_seq
  before insert on public.entry_audio
  for each row execute function app.assign_audio_seq();

-- ---------------------------------------------------------------------------
-- entries.audio_url and entries.transcript_raw are derived from the segments.
-- Guarded on status = 'draft', so this can never touch a signed entry.
-- ---------------------------------------------------------------------------
create or replace function app.refresh_entry_audio_rollup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry_id uuid := coalesce(new.entry_id, old.entry_id);
begin
  update public.entries e
     set audio_url = (
           select a.url from public.entry_audio a
            where a.entry_id = v_entry_id
            order by a.seq limit 1
         ),
         transcript_raw = (
           select nullif(string_agg(a.transcript, E'\n\n' order by a.seq), '')
             from public.entry_audio a
            where a.entry_id = v_entry_id
              and a.transcript is not null
              and length(btrim(a.transcript)) > 0
         )
   where e.id = v_entry_id
     and e.status = 'draft';

  return null;
end;
$$;

create trigger entry_audio_rollup
  after insert or update or delete on public.entry_audio
  for each row execute function app.refresh_entry_audio_rollup();

-- Immutability, same rule as every other child table.
create trigger entry_audio_enforce_immutable
  before insert or update or delete on public.entry_audio
  for each row execute function app.child_enforce_immutable();

-- ---------------------------------------------------------------------------
-- project_keywords — the manual half of the transcription vocabulary:
-- crew names, plant, and area names off the drawing register (brief §4).
-- The other half is derived from what the diary already contains, and the
-- fixed construction glossary lives in the application.
-- ---------------------------------------------------------------------------
create type public.keyword_category as enum ('person', 'plant', 'area', 'supplier', 'other');

create table public.project_keywords (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  term       text not null check (length(btrim(term)) between 2 and 60),
  category   public.keyword_category not null default 'other',
  created_at timestamptz not null default now(),
  unique (project_id, term)
);

create index project_keywords_project_idx on public.project_keywords (project_id);

-- ---------------------------------------------------------------------------
-- The boost list handed to the transcriber. SECURITY INVOKER on purpose: every
-- table it reads is already scoped by project membership, so a non-member gets
-- an empty array with no extra guard. Lives in `public` because the capture
-- route calls it over PostgREST as the signed-in supervisor.
-- ---------------------------------------------------------------------------
create or replace function public.project_keyterms(p_project_id uuid)
returns text[]
language sql
stable
set search_path = ''
as $$
  select coalesce(array_agg(term order by term), '{}')
  from (
    select distinct btrim(k.term) as term
      from public.project_keywords k
     where k.project_id = p_project_id
       and length(btrim(k.term)) >= 2
    union
    select distinct btrim(l.person_name)
      from public.labour l
      join public.entries e on e.id = l.entry_id
     where e.project_id = p_project_id
       and length(btrim(l.person_name)) >= 2
    union
    select distinct btrim(pl.item)
      from public.plant pl
      join public.entries e on e.id = pl.entry_id
     where e.project_id = p_project_id
       and length(btrim(pl.item)) >= 2
    union
    select distinct btrim(w.area)
      from public.work_items w
      join public.entries e on e.id = w.entry_id
     where e.project_id = p_project_id
       and length(btrim(coalesce(w.area, ''))) >= 2
    union
    select distinct btrim(pl.supplier)
      from public.plant pl
      join public.entries e on e.id = pl.entry_id
     where e.project_id = p_project_id
       and length(btrim(coalesce(pl.supplier, ''))) >= 2
    union
    select distinct btrim(po.supplier)
      from public.pours po
      join public.entries e on e.id = po.entry_id
     where e.project_id = p_project_id
       and length(btrim(coalesce(po.supplier, ''))) >= 2
  ) t;
$$;

comment on function public.project_keyterms(uuid) is
  'Transcription boost vocabulary for a project: manual keywords plus crew, plant, areas and suppliers the diary has already recorded. The fixed construction glossary is added by the application.';

grant execute on function public.project_keyterms(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.entry_audio      enable row level security;
alter table public.project_keywords enable row level security;

create policy entry_audio_select_member on public.entry_audio
  for select to authenticated
  using (app.can_read_entry(entry_id));

create policy entry_audio_insert_own_draft on public.entry_audio
  for insert to authenticated
  with check (app.can_write_entry(entry_id));

create policy entry_audio_update_own_draft on public.entry_audio
  for update to authenticated
  using (app.can_write_entry(entry_id))
  with check (app.can_write_entry(entry_id));

create policy entry_audio_delete_own_draft on public.entry_audio
  for delete to authenticated
  using (app.can_write_entry(entry_id));

create policy project_keywords_select_member on public.project_keywords
  for select to authenticated
  using (app.is_project_member(project_id));

create policy project_keywords_write_author on public.project_keywords
  for all to authenticated
  using (app.can_author_entries(project_id))
  with check (app.can_author_entries(project_id));

-- ---------------------------------------------------------------------------
-- Audio segments are part of the signed record, so they join the content hash.
-- Operational columns (transcript_status, transcript_error, transcribed_at,
-- client_ref) are excluded: they describe the pipeline, not the record.
-- ---------------------------------------------------------------------------
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
        from (select to_jsonb(t) - 'id' - 'entry_id' - 'created_at' as j
                from public.photos t where t.entry_id = p_entry.id) q
    ),
    'weather', (
      select coalesce(
               (select to_jsonb(w) - 'entry_id' - 'created_at'
                  from public.weather w where w.entry_id = p_entry.id),
               'null'::jsonb)
    )
  );
$$;
