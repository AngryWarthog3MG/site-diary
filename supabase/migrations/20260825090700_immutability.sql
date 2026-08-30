-- ============================================================================
-- 20260825090700_immutability.sql
-- Brief non-negotiable #2: signed entries are immutable. Enforced here, at the
-- database, so no client, service key, SQL console or future code path can
-- edit a signed record. Corrections are made by a new entry that sets
-- supersedes_entry_id.
--
-- Only postgres/supabase_admin can drop these triggers; service_role bypasses
-- RLS but NOT triggers.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- entries: block all UPDATE/DELETE once signed, and own the draft -> signed
-- transition — which is where the serial, the signature and the hash are all
-- written, in that order (entry_no is part of the hashed content).
-- ---------------------------------------------------------------------------
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

  -- UPDATE from here on.
  if old.status = 'signed' then
    raise exception 'entry % is signed and cannot be modified', old.entry_no
      using errcode = 'restrict_violation',
            hint = 'Issue a correction entry with supersedes_entry_id set instead.';
  end if;

  -- Identity of a draft is fixed at creation. entry_seq and entry_no are not
  -- in this list because they are still null at this point — they are issued
  -- below, on signing, and frozen from then on by the guard above.
  if new.id         is distinct from old.id
     or new.project_id is distinct from old.project_id
     or new.author_id  is distinct from old.author_id
     or new.created_at is distinct from old.created_at then
    raise exception 'entry identity columns (id, project_id, author_id, created_at) cannot be changed'
      using errcode = 'restrict_violation';
  end if;

  if new.status = 'signed' then
    v_gaps := app.entry_blocking_gaps(new.id);
    if array_length(v_gaps, 1) is not null then
      raise exception 'entry cannot be signed, blocking gaps remain: %',
                      array_to_string(v_gaps, ', ')
        using errcode = 'check_violation';
    end if;

    -- The serial is issued now and only now, so an abandoned draft never
    -- consumes a number. A client-supplied value is ignored — and could not
    -- have reached here anyway, since a draft carrying a serial fails the
    -- entries_signature_complete constraint.
    select a.o_entry_seq, a.o_entry_no
      into new.entry_seq, new.entry_no
      from app.allocate_entry_no(new.project_id) a;

    -- The signature is set here, not by the client.
    new.signed_at    := coalesce(new.signed_at, now());
    new.signed_by    := coalesce(new.signed_by, old.author_id);

    -- Hashed last: entry_no is part of the canonical content.
    new.content_hash := app.entry_content_hash(new);
  elsif new.entry_seq is not null or new.entry_no is not null then
    -- Belt and braces over the entries_signature_complete constraint, with a
    -- message that names the actual mistake.
    raise exception 'a draft entry cannot carry a serial; entry_no is issued on signing'
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$$;

create trigger entries_enforce_immutable
  before update or delete on public.entries
  for each row execute function app.entries_enforce_immutable();

-- ---------------------------------------------------------------------------
-- child tables: no INSERT, UPDATE or DELETE against a signed parent
-- ---------------------------------------------------------------------------
create or replace function app.child_enforce_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_entry uuid;
  v_new_entry uuid;
  v_status    public.entry_status;
  v_no        text;
begin
  if tg_op <> 'INSERT' then
    v_old_entry := (to_jsonb(old) ->> 'entry_id')::uuid;
  end if;
  if tg_op <> 'DELETE' then
    v_new_entry := (to_jsonb(new) ->> 'entry_id')::uuid;
  end if;

  if v_old_entry is not null then
    select e.status, e.entry_no into v_status, v_no
      from public.entries e where e.id = v_old_entry;
    if v_status = 'signed' then
      raise exception '% on %.% rejected: entry % is signed and immutable',
                      tg_op, tg_table_schema, tg_table_name, v_no
        using errcode = 'restrict_violation',
              hint = 'Issue a correction entry with supersedes_entry_id set instead.';
    end if;
  end if;

  if v_new_entry is not null and v_new_entry is distinct from v_old_entry then
    select e.status, e.entry_no into v_status, v_no
      from public.entries e where e.id = v_new_entry;
    if v_status = 'signed' then
      raise exception '% on %.% rejected: entry % is signed and immutable',
                      tg_op, tg_table_schema, tg_table_name, v_no
        using errcode = 'restrict_violation',
              hint = 'Issue a correction entry with supersedes_entry_id set instead.';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'entry_sections', 'labour', 'plant', 'work_items', 'variations',
    'delays', 'pours', 'quantities', 'weather', 'photos'
  ] loop
    execute format(
      'create trigger %I before insert or update or delete on public.%I
         for each row execute function app.child_enforce_immutable()',
      t || '_enforce_immutable', t);
  end loop;
end;
$$;
