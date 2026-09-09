-- ============================================================================
-- Shared drafts: a day belongs to the job, not to the phone it was typed on.
--
-- The first morning with two people on one job, the leading hand typed the
-- day in and the supervisor could see it but not touch it. Every write path —
-- child-table RLS, storage, the review RPC, the status update that signs —
-- ran through "the author's own draft". This widens that to "an unsigned
-- draft on a job where I hold an authoring role" (supervisor or admin, via
-- app.can_author_entries). A leading hand or PM still cannot write another
-- person's day, and nobody can touch a signed one.
--
-- Two consequences are made explicit here rather than left to chance:
--   * the signature is attributed to whoever signs (auth.uid()), no longer to
--     the author — the person putting their name to the day is the one whose
--     name goes on it;
--   * author_id stays what it was (already enforced as an identity column), so
--     the record still shows who started the day and who signed it.
-- Deleting a draft stays with its author: binning someone else's work is not
-- editing it.
-- ============================================================================

create or replace function app.can_write_entry(p_entry_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.entries e
     where e.id = p_entry_id
       and e.status = 'draft'
       and (e.author_id = auth.uid() or app.can_author_entries(e.project_id))
  );
$$;

drop policy if exists entries_update_own_draft on public.entries;
create policy entries_update_open_draft on public.entries
  for update to authenticated
  using (status = 'draft'
         and (author_id = (select auth.uid()) or app.can_author_entries(project_id)))
  with check (author_id = (select auth.uid()) or app.can_author_entries(project_id));

create or replace function app.entries_enforce_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_gaps text[];
begin
  if tg_op = 'DELETE' then
    if old.status = 'signed' then
      raise exception 'entry % is signed and cannot be deleted', old.entry_no
        using errcode = 'restrict_violation',
              hint = 'Issue a correction entry with supersedes_entry_id set instead.';
    end if;
    return old;
  end if;

  if old.status = 'signed' then
    raise exception 'entry % is signed and cannot be modified', old.entry_no
      using errcode = 'restrict_violation',
            hint = 'Issue a correction entry with supersedes_entry_id set instead.';
  end if;

  if new.id         is distinct from old.id
     or new.project_id is distinct from old.project_id
     or new.author_id  is distinct from old.author_id
     or new.created_at is distinct from old.created_at then
    raise exception 'entry identity columns (id, project_id, author_id, created_at) cannot be changed'
      using errcode = 'restrict_violation';
  end if;

  if new.status = 'signed' then
    -- Before anything else, and before the gap check, so an incomplete draft
    -- cannot mask the attempt behind a different error.
    if new.signed_at is not null or new.signed_by is not null then
      raise exception 'the signature is issued by the database; signed_at and signed_by cannot be supplied'
        using errcode = 'restrict_violation',
              hint = 'Update status alone. The database records who signed and when.';
    end if;

    v_gaps := app.entry_blocking_gaps(new.id);
    if array_length(v_gaps, 1) is not null then
      raise exception 'entry cannot be signed, blocking gaps remain: %',
                      array_to_string(v_gaps, ', ')
        using errcode = 'check_violation';
    end if;

    -- The reference is issued now, from the entry's own date.
    select a.o_entry_seq, a.o_entry_no
      into new.entry_seq, new.entry_no
      from app.allocate_entry_no(new.project_id, new.entry_date) a;

    new.signed_at    := now();
    -- Whoever is signing takes responsibility for the day — a supervisor may
    -- sign a colleague's draft. auth.uid() is null only for the service role,
    -- which never signs on site; the author is the honest fallback there.
    new.signed_by    := coalesce(auth.uid(), old.author_id);
    new.content_hash := app.entry_content_hash(new);
  elsif new.entry_seq is not null or new.entry_no is not null then
    raise exception 'a draft entry cannot carry a serial; entry_no is issued on signing'
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$$;
