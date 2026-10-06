-- ============================================================================
-- Who closes the day (README R126).
--
-- "Do not allow anybody to do the sign-off for the day apart from me. Still
-- allow the supervisor to do sign-off and the client to do sign-off, but the
-- overall closing of the day needs to be done by me only."
--
-- Three signatures already meet on a diary day. The supervisor's drawn mark
-- and the client's drawn mark are attachments to the record (entry_signatures,
-- 20260907090700). The third is the one that matters to the database: the
-- status change that issues the serial, stamps signed_by and computes the
-- hash — the closing of the day. Until now anyone with an authoring role on
-- the job could make it. A job can now name the one person who does.
--
-- projects.day_closer_id: null keeps today's rule; set, only that account's
-- signature is taken, and the trigger that issues the serial says so to
-- everyone else. Everyone else hands the day over: entries.ready_at / ready_by,
-- stamped by the database, so the closer's home shows what is waiting and a
-- push can say so. Nothing in the record's hash changes — the canonical JSON
-- names its keys, and these are not among them.
-- ============================================================================

alter table public.projects
  add column day_closer_id uuid references public.profiles (id);
comment on column public.projects.day_closer_id is
  'The one account whose signature closes a diary day on this job (README R126). Null: anyone with an authoring role.';

alter table public.entries
  add column ready_at   timestamptz,
  add column ready_by   uuid references public.profiles (id),
  add column ready_note text;
comment on column public.entries.ready_at is
  'When the day was handed over for the closer''s sign-off (README R126); stamped by the database. Not in the content hash.';

-- The closer must hold the job.
create or replace function app.projects_day_closer_is_member()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.day_closer_id is not null and not exists (
    select 1 from public.project_members m where m.project_id = new.id and m.user_id = new.day_closer_id
  ) then
    raise exception 'The person who closes the day must be a member of this job.' using errcode = 'check_violation';
  end if;
  return new;
end; $$;
create trigger projects_day_closer_is_member before insert or update of day_closer_id on public.projects
  for each row execute function app.projects_day_closer_is_member();

create or replace function app.entries_enforce_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_gaps   text[];
  v_closer uuid;
  v_name   text;
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

  -- Handing the day over for sign-off (README R126): the database stamps when and by whom; clearing it is allowed.
  if new.ready_at is distinct from old.ready_at then
    if new.ready_at is null then
      new.ready_by := null;
    else
      new.ready_at := now();
      new.ready_by := coalesce(auth.uid(), new.ready_by, old.author_id);
    end if;
  elsif new.ready_by is distinct from old.ready_by then
    new.ready_by := old.ready_by;
  end if;
  new.ready_note := nullif(btrim(coalesce(new.ready_note, '')), '');

  if new.status = 'signed' then
    -- Before anything else, and before the gap check, so an incomplete draft
    -- cannot mask the attempt behind a different error.
    if new.signed_at is not null or new.signed_by is not null then
      raise exception 'the signature is issued by the database; signed_at and signed_by cannot be supplied'
        using errcode = 'restrict_violation',
              hint = 'Update status alone. The database records who signed and when.';
    end if;

    -- Who closes the day (README R126): when the job names one person, nobody else's signature is taken — the
    -- supervisor's and the client's drawn marks are theirs; this one issues the serial and freezes the record.
    -- auth.uid() is null only for the service role, which never signs on site.
    select p.day_closer_id into v_closer from public.projects p where p.id = new.project_id;
    if v_closer is not null and auth.uid() is not null and auth.uid() <> v_closer then
      select pr.full_name into v_name from public.profiles pr where pr.id = v_closer;
      raise exception 'Only % closes the day on this job. Hand it over for sign-off instead.', coalesce(nullif(btrim(v_name), ''), 'the person named in Settings')
        using errcode = 'insufficient_privilege';
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
