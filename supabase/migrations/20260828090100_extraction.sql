-- ============================================================================
-- 20260828090100_extraction.sql
-- Extraction proposals.
--
-- Brief non-negotiable #1: "Nothing is stored without the supervisor
-- confirming it. The AI extracts; the supervisor approves." So extraction does
-- NOT write to labour, plant, work_items, variations, delays, pours or
-- quantities. It writes a proposal here, and the review screen (step 4) is
-- what turns approved items into the record.
--
-- Keeping the proposal after it has been applied is deliberate: when a number
-- is disputed, "the model heard five and the supervisor corrected it to four"
-- is exactly the sort of thing worth being able to show.
-- ============================================================================

create type public.extraction_status as enum ('pending', 'applied', 'superseded', 'discarded');

create table public.entry_extractions (
  id                uuid primary key default gen_random_uuid(),
  entry_id          uuid not null references public.entries (id) on delete cascade,

  status            public.extraction_status not null default 'pending',

  -- Provenance for the call itself.
  model             text not null,
  prompt_version    text not null,

  -- The transcript this was run against. If the entry is re-transcribed the
  -- proposal describes words that are no longer the record, and the review
  -- screen must treat it as stale rather than silently show it.
  transcript_sha256 text not null check (transcript_sha256 ~ '^[0-9a-f]{64}$'),

  -- The validated, schema-shaped extraction the review screen renders.
  proposal          jsonb not null,
  -- What the model actually returned, before validation.
  raw_response      jsonb,

  input_tokens      integer check (input_tokens >= 0),
  output_tokens     integer check (output_tokens >= 0),

  created_at        timestamptz not null default now(),
  applied_at        timestamptz,
  applied_by        uuid references auth.users (id) on delete restrict,

  constraint entry_extractions_applied_complete check (
    (status = 'applied' and applied_at is not null and applied_by is not null)
    or (status <> 'applied' and applied_at is null and applied_by is null)
  )
);

create index entry_extractions_entry_idx on public.entry_extractions (entry_id, created_at desc);

-- At most one proposal awaiting the supervisor at a time: re-running
-- extraction supersedes the previous attempt rather than stacking up
-- alternatives for them to choose between.
create unique index entry_extractions_one_pending
  on public.entry_extractions (entry_id)
  where status = 'pending';

comment on table public.entry_extractions is
  'What the model proposed for an entry. Never the record — the review screen applies approved items into the child tables.';

-- Frozen once the entry is signed, like every other child table. Not part of
-- the content hash: the record is what the supervisor signed, and the proposal
-- is retained history alongside it rather than a component of it.
create trigger entry_extractions_enforce_immutable
  before insert or update or delete on public.entry_extractions
  for each row execute function app.child_enforce_immutable();

-- ---------------------------------------------------------------------------
-- RLS — same shape as every other child table.
-- ---------------------------------------------------------------------------
alter table public.entry_extractions enable row level security;

create policy entry_extractions_select_member on public.entry_extractions
  for select to authenticated
  using (app.can_read_entry(entry_id));

create policy entry_extractions_insert_own_draft on public.entry_extractions
  for insert to authenticated
  with check (app.can_write_entry(entry_id));

create policy entry_extractions_update_own_draft on public.entry_extractions
  for update to authenticated
  using (app.can_write_entry(entry_id))
  with check (app.can_write_entry(entry_id));

create policy entry_extractions_delete_own_draft on public.entry_extractions
  for delete to authenticated
  using (app.can_write_entry(entry_id));
