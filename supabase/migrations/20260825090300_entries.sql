-- ============================================================================
-- 20260825090300_entries.sql
-- The diary entry and its child records.
--
-- Every extracted child row carries source_quote + confidence (brief §4) so the
-- review screen can show the supervisor which words a number came from, and so
-- the provenance survives into the signed record.
-- ============================================================================

create table public.entries (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references public.projects (id) on delete restrict,

  -- Allocated at signing, never at draft creation, so the serial run is
  -- gap-free: an abandoned draft consumes no number. entry_seq is the raw
  -- counter; entry_no is the human-facing serial, e.g. KBS_C001_DD_142.
  -- Both are null while the entry is a draft.
  entry_seq           integer,
  entry_no            text,

  entry_date          date not null,
  author_id           uuid not null references auth.users (id) on delete restrict,

  status              public.entry_status not null default 'draft',
  signed_at           timestamptz,
  signed_by           uuid references auth.users (id) on delete restrict,
  content_hash        text check (content_hash ~ '^[0-9a-f]{64}$'),

  audio_url           text,
  transcript_raw      text,

  -- A correction is a new entry that points at the entry it replaces. Signed
  -- entries are never edited; they are superseded.
  supersedes_entry_id uuid references public.entries (id) on delete restrict,

  created_at          timestamptz not null default now(),

  unique (project_id, entry_seq),
  unique (entry_no),
  constraint entries_no_self_supersede
    check (supersedes_entry_id is null or supersedes_entry_id <> id),
  -- A draft carries no serial and no signature; a signed entry carries both.
  -- This is what stops a client inventing its own entry_no on insert: there is
  -- no legal draft row that has one.
  constraint entries_signature_complete check (
    (status = 'draft'
       and entry_seq is null and entry_no is null
       and signed_at is null and signed_by is null and content_hash is null)
    or
    (status = 'signed'
       and entry_seq is not null and entry_no is not null
       and signed_at is not null and signed_by is not null and content_hash is not null)
  )
);

-- Brief §3 specifies UNIQUE (project_id, entry_date, author_id). That is scoped
-- to original entries only, otherwise a correction entry — same project, same
-- work date, same supervisor — could never be written.
create unique index entries_one_original_per_author_per_day
  on public.entries (project_id, entry_date, author_id)
  where supersedes_entry_id is null;

create index entries_project_date_idx on public.entries (project_id, entry_date desc);
create index entries_author_idx       on public.entries (author_id);
create index entries_status_idx       on public.entries (project_id, status);
create index entries_supersedes_idx   on public.entries (supersedes_entry_id)
  where supersedes_entry_id is not null;

-- Semantic query path (brief §5) searches transcript_raw. Index declared here
-- so the query layer does not need a schema change later.
create index entries_transcript_fts_idx
  on public.entries using gin (to_tsvector('english', coalesce(transcript_raw, '')));

-- ---------------------------------------------------------------------------
-- Section completeness (brief §4)
-- ---------------------------------------------------------------------------
create table public.entry_sections (
  entry_id uuid not null references public.entries (id) on delete cascade,
  section  public.entry_section not null,
  state    public.section_state not null default 'gap',
  -- What the supervisor was asked, and what they answered, when confirming a nil.
  note     text,
  primary key (entry_id, section)
);

comment on table public.entry_sections is
  'Per-section capture state. nil_confirmed records a deliberate "nothing today"; gap records an unanswered section.';

-- ---------------------------------------------------------------------------
-- Child records
-- ---------------------------------------------------------------------------
create table public.labour (
  id             uuid primary key default gen_random_uuid(),
  entry_id       uuid not null references public.entries (id) on delete cascade,
  person_name    text not null check (length(btrim(person_name)) > 0),
  role           text,
  area           text,
  hours          numeric(6,2) check (hours >= 0),
  overtime_hours numeric(6,2) check (overtime_hours >= 0),
  source_quote   text,
  confidence     public.confidence,
  created_at     timestamptz not null default now()
);

create table public.plant (
  id           uuid primary key default gen_random_uuid(),
  entry_id     uuid not null references public.entries (id) on delete cascade,
  item         text not null check (length(btrim(item)) > 0),
  hire_type    public.hire_type,
  hours        numeric(6,2) check (hours >= 0),
  idle_hours   numeric(6,2) check (idle_hours >= 0),
  supplier     text,
  source_quote text,
  confidence   public.confidence,
  created_at   timestamptz not null default now()
);

create table public.work_items (
  id               uuid primary key default gen_random_uuid(),
  entry_id         uuid not null references public.entries (id) on delete cascade,
  area             text,
  description      text not null check (length(btrim(description)) > 0),
  percent_complete numeric(5,2) check (percent_complete between 0 and 100),
  source_quote     text,
  confidence       public.confidence,
  created_at       timestamptz not null default now()
);

create table public.variations (
  id             uuid primary key default gen_random_uuid(),
  entry_id       uuid not null references public.entries (id) on delete cascade,
  description    text not null check (length(btrim(description)) > 0),
  directed_by    text,
  directed_at    timestamptz,
  vr_ref         text,
  estimated_cost numeric(14,2) check (estimated_cost >= 0),
  photo_urls     text[] not null default '{}',
  source_quote   text,
  confidence     public.confidence,
  created_at     timestamptz not null default now()
);

create table public.delays (
  id                  uuid primary key default gen_random_uuid(),
  entry_id            uuid not null references public.entries (id) on delete cascade,
  start_time          time,
  end_time            time,
  duration_mins       integer check (duration_mins >= 0),
  cause               text,
  personnel_affected  integer check (personnel_affected >= 0),
  category            public.delay_category,
  source_quote        text,
  confidence          public.confidence,
  created_at          timestamptz not null default now()
);

create table public.pours (
  id                uuid primary key default gen_random_uuid(),
  entry_id          uuid not null references public.entries (id) on delete cascade,
  location          text,
  volume_m3         numeric(10,2) check (volume_m3 >= 0),
  mix_spec          text,
  supplier          text,
  docket_nos        text[] not null default '{}',
  start_time        time,
  finish_time       time,
  docket_photo_urls text[] not null default '{}',
  source_quote      text,
  confidence        public.confidence,
  created_at        timestamptz not null default now()
);

-- The extensible totals table: pipe m, topsoil m2, plants no., formwork m2.
create table public.quantities (
  id           uuid primary key default gen_random_uuid(),
  entry_id     uuid not null references public.entries (id) on delete cascade,
  item_type    text not null check (length(btrim(item_type)) > 0),
  area         text,
  quantity     numeric(14,3),
  unit         text,
  source_quote text,
  confidence   public.confidence,
  created_at   timestamptz not null default now()
);

-- Weather is fetched from BOM, never spoken, never extracted — so it carries no
-- source_quote/confidence. One row per entry.
create table public.weather (
  entry_id        uuid primary key references public.entries (id) on delete cascade,
  temp_max        numeric(5,2),
  temp_min        numeric(5,2),
  rainfall_mm     numeric(6,2) check (rainfall_mm >= 0),
  wind_dir        text,
  wind_kmh        numeric(6,2) check (wind_kmh >= 0),
  source          public.weather_source not null,
  observed_impact text,
  created_at      timestamptz not null default now()
);

create table public.photos (
  id         uuid primary key default gen_random_uuid(),
  entry_id   uuid not null references public.entries (id) on delete cascade,
  url        text not null check (length(btrim(url)) > 0),
  caption    text,
  taken_at   timestamptz,
  lat        double precision check (lat between -90 and 90),
  lng        double precision check (lng between -180 and 180),
  created_at timestamptz not null default now()
);

create index labour_entry_idx     on public.labour     (entry_id);
create index plant_entry_idx      on public.plant      (entry_id);
create index work_items_entry_idx on public.work_items (entry_id);
create index variations_entry_idx on public.variations (entry_id);
create index delays_entry_idx     on public.delays     (entry_id);
create index pours_entry_idx      on public.pours      (entry_id);
create index quantities_entry_idx on public.quantities (entry_id);
create index photos_entry_idx     on public.photos     (entry_id);
create index quantities_item_type_idx on public.quantities (item_type);
