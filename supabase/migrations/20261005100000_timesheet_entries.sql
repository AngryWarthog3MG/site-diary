-- Time the office adds to the timesheet (README R122). "Evan and Matthew both worked at the office on Tuesday the 29th,
-- 6:30 till 1 — I need to add them into the timesheet to get paid." The timesheet reads the diaries' labour lists, and a
-- day at the office, the yard or a training room has no diary. This is the one other source of an hour on the sheet:
-- a line typed by a company admin, naming the person, the day, the clocks or the hours, and where the time was worked.
-- It is never a diary row and never reads as one — the sheet marks it with its place. Like the rest of the record it is
-- not edited and not deleted: a wrong line is removed (voided, once, with a reason) and the right one added.

create table public.timesheet_entries (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organisations (id),
  person_name  text not null check (btrim(person_name) <> ''),
  work_date    date not null,
  start_time   time,
  finish_time  time,
  break_mins   integer not null default 0 check (break_mins between 0 and 600),
  hours        numeric(5,2) not null check (hours > 0 and hours <= 24),
  place        text not null default 'Office' check (btrim(place) <> '' and char_length(place) <= 40),
  note         text,
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  voided_at    timestamptz,
  voided_by    uuid,
  void_reason  text,
  constraint timesheet_entries_created_by_fkey foreign key (created_by) references public.profiles (id),
  constraint timesheet_entries_voided_by_fkey foreign key (voided_by) references public.profiles (id),
  constraint timesheet_entries_clocks_together check ((start_time is null) = (finish_time is null)),
  constraint timesheet_entries_clocks_in_order check (start_time is null or finish_time > start_time),
  constraint timesheet_entries_void_whole check ((voided_at is null) = (void_reason is null))
);
create index timesheet_entries_week on public.timesheet_entries (org_id, work_date);
-- A second tap of Save is not a second day's pay.
create unique index timesheet_entries_no_double
  on public.timesheet_entries (org_id, lower(person_name), work_date, coalesce(start_time, '00:00'), lower(place))
  where voided_at is null;

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
create trigger timesheet_entries_guard before insert or update on public.timesheet_entries
  for each row execute function app.timesheet_entries_guard();
create trigger a_timesheet_entries_no_delete before delete on public.timesheet_entries
  for each row execute function app.frozen_row();

-- Pay is the office's: pm and admin read it (the company weekly prints the same sheet); only an admin adds or removes,
-- because Timesheets is an admin screen. Site roles read none of it.
alter table public.timesheet_entries enable row level security;
create policy timesheet_entries_select on public.timesheet_entries for select to authenticated using (app.is_org_office(org_id));
create policy timesheet_entries_insert on public.timesheet_entries for insert to authenticated with check (app.is_org_admin(org_id));
create policy timesheet_entries_void on public.timesheet_entries for update to authenticated
  using (app.is_org_admin(org_id)) with check (app.is_org_admin(org_id));
revoke all on public.timesheet_entries from anon, authenticated;
grant select, insert on public.timesheet_entries to authenticated;
grant update (void_reason) on public.timesheet_entries to authenticated;
grant all on public.timesheet_entries to service_role;
