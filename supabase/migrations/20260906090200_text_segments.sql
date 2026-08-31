-- ============================================================================
-- 20260906090200_text_segments.sql
-- Typed diary text as first-class segments.
--
-- entries.transcript_raw is a DERIVED column: app.refresh_entry_audio_rollup
-- rebuilds it from entry_audio on every audio change. The first text capture
-- appended straight into that column, so the next voice recording on the same
-- day silently erased the typed words — and a retried request appended them
-- twice. Typed text now lives in its own table, keyed by the queue item's
-- client_ref (idempotent, race-safe), and the rollup builds the transcript
-- from both sources.
-- ============================================================================

create table public.entry_text (
  id         uuid primary key default gen_random_uuid(),
  entry_id   uuid not null references public.entries (id) on delete cascade,
  client_ref text not null,
  body       text not null check (length(btrim(body)) > 0),
  written_at timestamptz,
  created_at timestamptz not null default now(),
  unique (entry_id, client_ref)
);

create index entry_text_entry_idx on public.entry_text (entry_id);

alter table public.entry_text enable row level security;

create policy entry_text_select_member on public.entry_text
  for select to authenticated
  using (app.can_read_entry(entry_id));

create policy entry_text_insert_own_draft on public.entry_text
  for insert to authenticated
  with check (app.can_write_entry(entry_id));

create policy entry_text_delete_own_draft on public.entry_text
  for delete to authenticated
  using (app.can_write_entry(entry_id));

create trigger entry_text_enforce_immutable
  before insert or update or delete on public.entry_text
  for each row execute function app.child_enforce_immutable();

comment on table public.entry_text is
  'Typed diary notes for a draft entry. Raw capture like entry_audio, keyed by client_ref so a retried request cannot double-append; transcript_raw is rebuilt from audio and text together.';

-- ---------------------------------------------------------------------------
-- The rollup now reads both sources: audio segments in seq order, then typed
-- notes in the order they were written. Still guarded on draft status.
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
           select nullif(string_agg(part, E'\n\n' order by ord, sub), '')
             from (
               select 1 as ord, a.seq::numeric as sub, a.transcript as part
                 from public.entry_audio a
                where a.entry_id = v_entry_id
                  and a.transcript is not null
                  and length(btrim(a.transcript)) > 0
               union all
               select 2 as ord,
                      extract(epoch from coalesce(t.written_at, t.created_at)) as sub,
                      t.body as part
                 from public.entry_text t
                where t.entry_id = v_entry_id
             ) parts
         )
   where e.id = v_entry_id
     and e.status = 'draft';

  return null;
end;
$$;

create trigger entry_text_rollup
  after insert or update or delete on public.entry_text
  for each row execute function app.refresh_entry_audio_rollup();

grant select, insert, delete on public.entry_text to authenticated;
grant all on public.entry_text to service_role;
