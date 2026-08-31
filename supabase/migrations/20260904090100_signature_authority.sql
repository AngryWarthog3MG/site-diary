-- ============================================================================
-- The database is the sole authority on the signature.
--
-- app.entries_enforce_immutable() previously wrote
--     new.signed_at := coalesce(new.signed_at, now());
--     new.signed_by := coalesce(new.signed_by, old.author_id);
-- which preserved whatever the client sent. The comment above those lines said
-- "The signature is set here, not by the client" — it was not.
--
-- entries_update_own_draft permits an author to move their own draft to
-- 'signed', and its WITH CHECK constrains only author_id. So a supervisor
-- using their own session could PATCH the row directly with a back-dated
-- signed_at and another member's uuid in signed_by, and the coalesce would
-- keep both. The entry then became immutable carrying a forged signature, and
-- because the content hash deliberately excludes the signature block
-- (status, signed_at, signed_by, content_hash), app.verify_entry_hash() still
-- returned true. Nothing in the record would show it.
--
-- The fix refuses the attempt rather than silently overwriting it: a client
-- supplying either column is always wrong, and on an evidentiary record a
-- rejected write is worth more than a quietly corrected one. The check runs
-- before the blocking-gap check so it cannot be masked by an incomplete draft.
--
-- No signed rows are altered and the content hash is unchanged, so nothing
-- already signed is invalidated by this migration.
-- ============================================================================

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
    new.signed_by    := old.author_id;
    new.content_hash := app.entry_content_hash(new);
  elsif new.entry_seq is not null or new.entry_no is not null then
    raise exception 'a draft entry cannot carry a serial; entry_no is issued on signing'
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$$;
