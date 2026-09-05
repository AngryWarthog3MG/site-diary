-- ============================================================================
-- 20260907092000_one_original_per_day_order.sql
-- app.one_original_per_day() answered a case that app.validate_supersedes()
-- owns. BEFORE INSERT triggers fire in name order, so this one ran first and
-- a correction pointing at a *draft* was refused for its date rather than for
-- "only a signed entry can be superseded" — the SQL suite caught the wrong
-- message. The date and current-version checks now apply only once the target
-- is a signed entry on the same project; everything else is left to the
-- older trigger, whose messages the suite pins.
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

  select entry_date, status, project_id into v_target
    from public.entries where id = new.supersedes_entry_id;
  -- Missing, unsigned or foreign-project targets are validate_supersedes()'s to refuse.
  if not found or v_target.status <> 'signed' or v_target.project_id <> new.project_id then
    return new;
  end if;

  -- A correction belongs to the day it corrects, and supersedes the version
  -- that currently stands — not one already replaced by a signed correction.
  if v_target.entry_date <> new.entry_date then
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
