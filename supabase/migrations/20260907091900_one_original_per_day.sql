-- ============================================================================
-- 20260907091900_one_original_per_day.sql
-- One document per day, after signing too.
--
-- entries_one_open_per_day (091500) stops two drafts existing side by side.
-- It says nothing about a day that is already signed: the partial index only
-- covers unsigned rows, and the older per-author index let a *second*
-- supervisor open a fresh original for a day someone else had signed. That
-- read on site as two documents for the one day — and the second one could be
-- signed, giving the day two signed records with no relationship between them.
--
-- Once a day has a signed entry, anything further for that day is a
-- correction: it must supersede the version that currently stands. The API
-- says so first; this is the backstop, and the database wins.
--
-- A trigger rather than a unique index on (project_id, entry_date) where
-- supersedes_entry_id is null: the sandbox already holds a day with three
-- originals from the per-author era, and an index cannot be created over it.
-- The trigger gives the same guarantee for everything from here on.
-- ============================================================================

create or replace function app.one_original_per_day()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_signed record;
  v_target record;
begin
  if new.supersedes_entry_id is null then
    select id, entry_no into v_signed
      from public.entries
     where project_id = new.project_id
       and entry_date = new.entry_date
       and status = 'signed'
     order by signed_at desc
     limit 1;
    if found then
      raise exception
        'entries_one_original_per_day: % already has a signed entry (%); a new entry for that day must be a correction that supersedes it',
        new.entry_date, v_signed.entry_no
        using errcode = 'unique_violation';
    end if;
    return new;
  end if;

  -- A correction belongs to the day it corrects, and supersedes the version
  -- that currently stands — not one already replaced by a signed correction.
  select entry_date into v_target from public.entries where id = new.supersedes_entry_id;
  if found and v_target.entry_date <> new.entry_date then
    raise exception 'a correction must carry the same date as the entry it supersedes (% vs %)',
      new.entry_date, v_target.entry_date;
  end if;
  if exists (
    select 1 from public.entries s
     where s.supersedes_entry_id = new.supersedes_entry_id
       and s.status = 'signed'
  ) then
    raise exception
      'entry % has already been superseded by a signed correction; correct the current version instead',
      new.supersedes_entry_id;
  end if;
  return new;
end;
$$;

comment on function app.one_original_per_day() is
  'BEFORE INSERT on entries: no second original once a day is signed; a correction carries the same date and supersedes the version that currently stands.';

drop trigger if exists entries_one_original_per_day on public.entries;
create trigger entries_one_original_per_day
  before insert on public.entries
  for each row execute function app.one_original_per_day();
