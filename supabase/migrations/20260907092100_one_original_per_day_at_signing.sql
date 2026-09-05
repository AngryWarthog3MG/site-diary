-- ============================================================================
-- 20260907092100_one_original_per_day_at_signing.sql
-- The one-original rule, at signing as well as at creation.
--
-- 091900 refuses a fresh original once a day is signed — on INSERT. Signing is
-- an UPDATE. A draft original that already existed before the day was signed
-- (there are such rows from the per-author era) could still be signed, and the
-- day would then carry two signed originals with no relationship between them.
-- Codex's second review put its finger on it. The same function now also runs
-- BEFORE UPDATE when a row becomes signed: an original may only sign if no
-- other signed original stands for that day, and a correction may only sign if
-- the version it supersedes is still the one that stands.
-- ============================================================================

create or replace function app.one_original_per_day()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_signed record;
  v_target record;
  v_signing boolean := tg_op = 'UPDATE' and new.status = 'signed' and old.status <> 'signed';
begin
  if tg_op = 'UPDATE' and not v_signing then
    return new;
  end if;

  if new.supersedes_entry_id is null then
    select id, entry_no into v_signed
      from public.entries
     where project_id = new.project_id
       and entry_date = new.entry_date
       and status = 'signed'
       and supersedes_entry_id is null
       and id <> new.id
     order by signed_at desc
     limit 1;
    if found then
      raise exception
        'entries_one_original_per_day: % already has a signed entry (%); % must be a correction that supersedes it',
        new.entry_date, v_signed.entry_no,
        case when v_signing then 'this entry cannot be signed as a second original — anything further for the day' else 'a new entry for that day' end
        using errcode = 'unique_violation';
    end if;
    return new;
  end if;

  select entry_date, status, project_id into v_target
    from public.entries where id = new.supersedes_entry_id;
  -- Missing, unsigned or foreign-project targets are validate_supersedes()'s to refuse.
  if not found or v_target.status <> 'signed' or v_target.project_id <> new.project_id then
    return new;
  end if;

  if v_target.entry_date <> new.entry_date then
    raise exception 'a correction must carry the same date as the entry it supersedes (% vs %)',
      new.entry_date, v_target.entry_date;
  end if;
  if exists (
    select 1 from public.entries s
     where s.supersedes_entry_id = new.supersedes_entry_id
       and s.status = 'signed'
       and s.id <> new.id
  ) then
    raise exception
      'entry % has already been superseded by a signed correction; correct the current version instead',
      new.supersedes_entry_id;
  end if;
  return new;
end;
$$;

drop trigger if exists entries_one_original_per_day on public.entries;
create trigger entries_one_original_per_day
  before insert or update of status on public.entries
  for each row execute function app.one_original_per_day();
