-- ============================================================================
-- Site sign-in, after review (Codex pass 14):
--   * one open sign-in per person means per person however the spaces fell —
--     "Danny  Rowe" and "Danny Rowe" are one name; the stored name is
--     collapsed to single spaces and the index matches the same way;
--   * a phone clock that is nowhere near the day is not a fact: the server's
--     time is used for that event and the row says so in its notes, rather
--     than the register sorting a 2036 sign-in to the end of the day.
-- ============================================================================

drop index if exists public.site_signins_one_open_idx;
create unique index site_signins_one_open_idx
  on public.site_signins (project_id, signin_date, regexp_replace(lower(btrim(person_name)), '\s+', ' ', 'g'))
  where signed_out_at is null;

create or replace function app.site_signins_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.person_name := regexp_replace(btrim(new.person_name), '\s+', ' ', 'g');
  new.company := nullif(regexp_replace(btrim(coalesce(new.company, '')), '\s+', ' ', 'g'), '');
  new.signed_in_at := now();
  new.signed_out_at := null;
  new.signed_out_on_device_at := null;
  new.signed_out_by := null;
  new.inducted := exists (
    select 1 from public.crew_inductions ci
     where ci.project_id = new.project_id
       and regexp_replace(lower(btrim(ci.person_name)), '\s+', ' ', 'g') = lower(new.person_name)
  );
  if new.signed_in_on_device_at is null
     or new.signed_in_on_device_at < (new.signin_date::timestamp at time zone 'Australia/Perth') - interval '1 day'
     or new.signed_in_on_device_at > (new.signin_date::timestamp at time zone 'Australia/Perth') + interval '2 days' then
    new.signed_in_on_device_at := now();
    new.notes := concat_ws(' · ', new.notes, 'phone clock out of range at sign-in; server time used');
  end if;
  return new;
end;
$$;

create or replace function app.site_signins_before_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.signed_out_at is not null then
    raise exception 'This sign-in is signed out and frozen.' using errcode = 'check_violation';
  end if;
  if new.project_id is distinct from old.project_id
     or new.signin_date is distinct from old.signin_date
     or new.person_name is distinct from old.person_name
     or new.company is distinct from old.company
     or new.person_kind is distinct from old.person_kind
     or new.inducted is distinct from old.inducted
     or new.signed_in_at is distinct from old.signed_in_at
     or new.signed_in_on_device_at is distinct from old.signed_in_on_device_at
     or new.signed_in_by is distinct from old.signed_in_by then
    raise exception 'A sign-in can only be signed out; nothing else on it changes.' using errcode = 'check_violation';
  end if;
  if new.signed_out_at is not null then
    new.signed_out_at := now();
    new.signed_out_by := coalesce(auth.uid(), new.signed_out_by);
    if new.signed_out_on_device_at is null
       or new.signed_out_on_device_at < old.signed_in_on_device_at
       or new.signed_out_on_device_at > (old.signin_date::timestamp at time zone 'Australia/Perth') + interval '2 days' then
      new.signed_out_on_device_at := now();
      new.notes := concat_ws(' · ', new.notes, 'phone clock out of range at sign-out; server time used');
    end if;
  end if;
  return new;
end;
$$;
