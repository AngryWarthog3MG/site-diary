-- ============================================================================
-- Inducting someone by hand (README R88).
--
-- Until now an induction was recorded only on the day, by the button on a
-- sign-on or a ticket row: today's date, no notes, only a name already on the
-- roster. A supervisor inducting a subbie on Monday and writing it up on
-- Wednesday, or inducting a visitor who is on no roster, had nowhere to put
-- it. So the row takes the date it happened and what was covered, from
-- whoever runs the talks, on the members screen.
--
-- The table is unchanged. What changes is the rule at the door: the name is
-- tidied so "  hamish   hayden " and "Hamish Hayden" are one person (the
-- unique index already compares them lower-cased), the date can be any day
-- up to today and never after it, and who recorded it is stamped when the
-- caller does not say.
-- ============================================================================

create or replace function app.crew_inductions_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.person_name := regexp_replace(btrim(new.person_name), '\s+', ' ', 'g');
  if length(new.person_name) = 0 then
    raise exception 'Who was inducted?' using errcode = 'check_violation';
  end if;
  if new.inducted_on > app.perth_today() then
    raise exception 'Record an induction once it has happened.' using errcode = 'check_violation';
  end if;
  new.notes := nullif(regexp_replace(btrim(coalesce(new.notes, '')), '\s+', ' ', 'g'), '');
  if tg_op = 'INSERT' then
    new.inducted_by := coalesce(new.inducted_by, (select auth.uid()));
    new.created_at := now();
  end if;
  return new;
end; $$;

create trigger a_crew_inductions_before_write before insert or update on public.crew_inductions
  for each row execute function app.crew_inductions_before_write();

comment on table public.crew_inductions is
  'Who has been inducted onto this job, by name, on what day, and what was covered. One per person per job. Recorded on the day by a sign-on, or by hand afterwards.';
