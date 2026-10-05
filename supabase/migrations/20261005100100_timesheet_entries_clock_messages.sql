-- The guard ran before the table's own checks, so clocks the wrong way round were refused with the break's message
-- (README R122). It now says what is actually wrong: a clock missing, or a finish that is not after the start.

create or replace function app.timesheet_entries_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_worked numeric;
begin
  if tg_op = 'INSERT' then
    new.person_name := btrim(regexp_replace(new.person_name, '\s+', ' ', 'g'));
    new.place := btrim(regexp_replace(coalesce(new.place, 'Office'), '\s+', ' ', 'g'));
    new.note := nullif(btrim(coalesce(new.note, '')), '');
    new.created_at := now();
    if (select auth.uid()) is not null then new.created_by := (select auth.uid()); end if;
    new.voided_at := null; new.voided_by := null; new.void_reason := null;
    if new.work_date > (now() at time zone 'Australia/Perth')::date then
      raise exception 'Time cannot be added for a day in the future.' using errcode = 'check_violation';
    end if;
    if (new.start_time is null) <> (new.finish_time is null) then
      raise exception 'Give both the start and the finish, or neither.' using errcode = 'check_violation';
    end if;
    if new.start_time is not null and new.finish_time <= new.start_time then
      raise exception 'The finish must be after the start. For a shift past midnight, give the hours instead.' using errcode = 'check_violation';
    end if;
    -- With clocks, the hours are the clocks' arithmetic and nothing else; without, they are the figure typed.
    if new.start_time is not null and new.finish_time is not null then
      v_worked := round((extract(epoch from (new.finish_time - new.start_time)) / 3600.0 - new.break_mins / 60.0)::numeric, 2);
      if v_worked <= 0 then
        raise exception 'The break is as long as the time worked.' using errcode = 'check_violation';
      end if;
      new.hours := v_worked;
    elsif new.hours is null then
      raise exception 'Give the start and finish, or the hours.' using errcode = 'check_violation';
    end if;
    if new.start_time is not null and exists (
      select 1 from public.timesheet_entries t
       where t.org_id = new.org_id and t.work_date = new.work_date and t.voided_at is null
         and lower(t.person_name) = lower(new.person_name)
         and t.start_time is not null and t.start_time < new.finish_time and new.start_time < t.finish_time
    ) then
      raise exception '% already has added time on that day overlapping these clocks. Remove that line first.', new.person_name
        using errcode = 'unique_violation';
    end if;
    return new;
  end if;

  -- An update is the removal and nothing else: once, with its reason, everything else as it was.
  if old.voided_at is not null then
    raise exception 'This line has already been removed.' using errcode = 'check_violation';
  end if;
  if (to_jsonb(new) - 'voided_at' - 'voided_by' - 'void_reason') is distinct from (to_jsonb(old) - 'voided_at' - 'voided_by' - 'void_reason') then
    raise exception 'Added time is not edited. Remove the line and add the right one.' using errcode = 'check_violation';
  end if;
  new.void_reason := nullif(btrim(coalesce(new.void_reason, '')), '');
  if new.void_reason is null then
    raise exception 'Say why the line is being removed.' using errcode = 'check_violation';
  end if;
  new.voided_at := now();
  new.voided_by := (select auth.uid());
  return new;
end;
$$;
