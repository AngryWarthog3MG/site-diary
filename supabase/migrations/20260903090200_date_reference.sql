-- ============================================================================
-- 20260903090200_date_reference.sql
-- Entry references become {ORG}-{DATE}: KBL-2026-08-27.
--
-- Owner call, superseding the hyphenated-sequence form from this morning: the
-- date IS the identity of a daily record, so the reference says it outright.
-- A correction signed for the same day takes a suffix (KBL-2026-08-27-2), as
-- does the rare same-day entry from a second project under the one org —
-- global uniqueness of entry_no is preserved by construction. The per-project
-- sequence survives underneath for ordering and counting; it is no longer the
-- public name.
-- ============================================================================

drop function if exists app.allocate_entry_no(uuid);

create or replace function app.allocate_entry_no(
  p_project_id  uuid,
  p_entry_date  date,
  out o_entry_seq integer,
  out o_entry_no  text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_code  text;
  v_base      text;
  v_candidate text;
  v_n         integer := 2;
begin
  update public.projects p
     set next_entry_seq = p.next_entry_seq + 1
   where p.id = p_project_id
  returning p.next_entry_seq - 1 into o_entry_seq;

  if o_entry_seq is null then
    raise exception 'project % does not exist', p_project_id
      using errcode = 'foreign_key_violation';
  end if;

  select o.code into v_org_code
    from public.organisations o
    join public.projects p on p.org_id = o.id
   where p.id = p_project_id;

  v_base := format('%s-%s', v_org_code, to_char(p_entry_date, 'YYYY-MM-DD'));
  v_candidate := v_base;
  while exists (select 1 from public.entries e where e.entry_no = v_candidate) loop
    v_candidate := v_base || '-' || v_n;
    v_n := v_n + 1;
  end loop;

  o_entry_no := v_candidate;
end;
$$;

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

    new.signed_at    := coalesce(new.signed_at, now());
    new.signed_by    := coalesce(new.signed_by, old.author_id);
    new.content_hash := app.entry_content_hash(new);
  elsif new.entry_seq is not null or new.entry_no is not null then
    raise exception 'a draft entry cannot carry a serial; entry_no is issued on signing'
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$$;

-- The one-argument overload must go, or every unqualified call is ambiguous
-- against the new defaulted signature.
drop function if exists app.project_next_entry_no(uuid);

-- Provisional display. The true reference is issued at signing from the
-- entry's own date; this exists for screens, which should pass the device's
-- local date. The fallback is Perth purely so a bare call shows something.
create or replace function app.project_next_entry_no(
  p_project_id uuid,
  p_entry_date date default null
)
returns text
language sql
stable
set search_path = ''
as $$
  select format('%s-%s', o.code,
                to_char(coalesce(p_entry_date, (now() at time zone 'Australia/Perth')::date),
                        'YYYY-MM-DD'))
    from public.projects p
    join public.organisations o on o.id = p.org_id
   where p.id = p_project_id;
$$;

grant execute on function app.project_next_entry_no(uuid, date) to authenticated, service_role;
