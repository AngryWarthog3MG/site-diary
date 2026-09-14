-- ============================================================================
-- Site sign-in: who is on site, in and out at the gate.
--
-- The first module of the safety half of the app. Every person on site each
-- day — crew, subcontractor, visitor, delivery — is signed in from the
-- supervisor's (or leading hand's) phone as they arrive and signed out as they
-- leave. The day's register is the roll call in an emergency and the
-- attendance evidence behind a labour claim months later.
--
-- Facts the database owns, not the phone:
--   * `inducted` is decided at sign-in from crew_inductions, the way the
--     prestart's sign-on does — a fact about that moment, never recomputed.
--   * `signed_in_at` / `signed_out_at` are the server's clock (arrival);
--     `*_on_device_at` are the phone's — with no signal the phone's time is
--     the truth and the arrival is noted, as the prestart PDF already does.
--   * A signed-out row is frozen. A mistake at the gate is deleted while the
--     row is still open, by the person who made it, and never after.
-- One open sign-in per person per project-day: tapping the same name twice
-- is refused, not doubled.
-- ============================================================================

create table public.site_signins (
  id                      uuid primary key default gen_random_uuid(),
  project_id              uuid not null references public.projects (id) on delete restrict,
  signin_date             date not null,
  person_name             text not null check (length(btrim(person_name)) > 0),
  company                 text,
  person_kind             text not null default 'crew'
                          check (person_kind in ('crew', 'subcontractor', 'visitor', 'delivery')),
  inducted                boolean,
  signed_in_at            timestamptz not null default now(),
  signed_in_on_device_at  timestamptz not null default now(),
  signed_out_at           timestamptz,
  signed_out_on_device_at timestamptz,
  signed_in_by            uuid not null references auth.users (id),
  signed_out_by           uuid references auth.users (id),
  notes                   text,
  created_at              timestamptz not null default now()
);
create index site_signins_day_idx on public.site_signins (project_id, signin_date desc, signed_in_on_device_at);
create unique index site_signins_one_open_idx
  on public.site_signins (project_id, signin_date, lower(btrim(person_name)))
  where signed_out_at is null;

-- The database decides the facts of arrival.
create or replace function app.site_signins_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.person_name := btrim(new.person_name);
  new.company := nullif(btrim(coalesce(new.company, '')), '');
  new.signed_in_at := now();
  new.signed_out_at := null;
  new.signed_out_on_device_at := null;
  new.signed_out_by := null;
  new.inducted := exists (
    select 1 from public.crew_inductions ci
     where ci.project_id = new.project_id
       and lower(ci.person_name) = lower(new.person_name)
  );
  return new;
end;
$$;
create trigger a_site_signins_before_insert
  before insert on public.site_signins
  for each row execute function app.site_signins_before_insert();

-- The only change to a sign-in is the sign-out; after that it is frozen.
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
    new.signed_out_on_device_at := coalesce(new.signed_out_on_device_at, now());
    new.signed_out_by := coalesce(auth.uid(), new.signed_out_by);
  end if;
  return new;
end;
$$;
create trigger a_site_signins_before_update
  before update on public.site_signins
  for each row execute function app.site_signins_before_update();

alter table public.site_signins enable row level security;

create policy site_signins_select_member on public.site_signins
  for select to authenticated using (app.is_project_member(project_id));
-- Gate duty is whoever runs prestarts: supervisor, admin, leading hand.
create policy site_signins_insert_crew on public.site_signins
  for insert to authenticated
  with check (app.can_run_talks(project_id) and signed_in_by = (select auth.uid()));
create policy site_signins_signout_crew on public.site_signins
  for update to authenticated
  using (app.can_run_talks(project_id) and signed_out_at is null)
  with check (app.can_run_talks(project_id));
-- A wrong tap is undone by whoever tapped it, while the row is still open.
create policy site_signins_delete_own_open on public.site_signins
  for delete to authenticated
  using (signed_in_by = (select auth.uid()) and signed_out_at is null and app.can_run_talks(project_id));

grant select, insert, update, delete on public.site_signins to authenticated;
grant all on public.site_signins to service_role;
