-- ============================================================================
-- The visitor gate: a QR code on the gate sign, a sign-in on the visitor's
-- own phone, no account.
--
-- A project has a gate code (rotatable; the printed sign carries it). The
-- public page it opens takes a name, a company, why they are here, a
-- contact number, the site rules acknowledged, and a finger signature; the
-- server writes the sign-in with the service role, marked self_signed, so
-- it lands in the same register as the supervisor's taps and the same
-- rules apply — one open sign-in per person per day, frozen at sign-out.
-- Nobody signed in at the gate can be anyone but themselves: the row
-- carries no account, and the phone that made it is the only one that can
-- sign it out.
-- ============================================================================

create table public.gate_tokens (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete restrict,
  token       text not null unique check (length(token) >= 16),
  rules       text,
  active      boolean not null default true,
  created_by  uuid references auth.users (id),
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz
);
create index gate_tokens_project_idx on public.gate_tokens (project_id, active);

alter table public.site_signins alter column signed_in_by drop not null;
alter table public.site_signins
  add column self_signed boolean not null default false,
  add column contact text,
  add column signature_path text,
  add column rules_acknowledged_at timestamptz;

create or replace function app.site_signins_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.person_name := regexp_replace(btrim(new.person_name), '\s+', ' ', 'g');
  new.company := nullif(regexp_replace(btrim(coalesce(new.company, '')), '\s+', ' ', 'g'), '');
  new.contact := nullif(btrim(coalesce(new.contact, '')), '');
  if new.signed_in_by is null and not new.self_signed then
    raise exception 'A sign-in is made by someone: the gate phone, or the visitor themselves.' using errcode = 'check_violation';
  end if;
  if new.self_signed and auth.uid() is not null then
    raise exception 'A self-signed sign-in comes through the gate, not from an account.' using errcode = 'check_violation';
  end if;
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
     or new.contact is distinct from old.contact
     or new.person_kind is distinct from old.person_kind
     or new.inducted is distinct from old.inducted
     or new.self_signed is distinct from old.self_signed
     or new.signature_path is distinct from old.signature_path
     or new.rules_acknowledged_at is distinct from old.rules_acknowledged_at
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

alter table public.gate_tokens enable row level security;
create policy gate_tokens_select_member on public.gate_tokens
  for select to authenticated using (app.is_project_member(project_id));
create policy gate_tokens_write_managers on public.gate_tokens
  for all to authenticated
  using (app.can_manage_incidents(project_id)) with check (app.can_manage_incidents(project_id));
grant select, insert, update on public.gate_tokens to authenticated;
grant all on public.gate_tokens to service_role;
