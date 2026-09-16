-- ============================================================================
-- Asbestos: the site's register (received or our own), its management plan,
-- who on the crew has been told, and licensed removal notified in time.
--
-- WHS (General) Regulations 2022 (WA):
--   reg. 425 — the person with management or control of a workplace keeps an
--     asbestos register there, recording asbestos identified or presumed: the
--     date identified, location, type and condition. Not required where the
--     building was constructed after 31 December 2003, no asbestos has been
--     identified, AND none is likely to be present — all three limbs.
--   reg. 429 — where asbestos is identified or presumed, a written asbestos
--     management plan, kept up to date and readily accessible; WorkSafe WA
--     guidance: reviewed at least every five years.
--   reg. 466 — licensed removal notified to WorkSafe at least five days before
--     it starts; for an emergency, immediately by phone and in writing within
--     24 hours. Friable asbestos needs a Class A licence; more than 10 m² of
--     non-friable needs Class A or Class B.
--
-- The research's design point (README R59, entry 04) decides the shape: the
-- register duty sits with the person with MANAGEMENT OR CONTROL of the
-- workplace, which on a principal contractor's site is usually not this
-- company. So a register here is most often RECEIVED — who holds the duty, the
-- document they gave us, the date — and what this company does with it is
-- tell the crew and record who was told. Authoring our own is supported for the
-- sites we control. Every version is kept; a newer one supersedes, never
-- overwrites.
-- ============================================================================

create table public.asbestos_registers (
  id                     uuid primary key default gen_random_uuid(),
  project_id             uuid not null references public.projects (id) on delete restrict,
  status                 text not null check (status in ('received', 'own', 'not_required')),
  -- Who holds the duty (reg. 425): the principal contractor, the owner, us.
  duty_holder            text not null check (length(btrim(duty_holder)) > 0),
  register_date          date not null,
  reference              text,
  -- What it says, in brief, and whether asbestos is identified or presumed on this workplace.
  summary                text,
  asbestos_present       boolean not null default false,
  file_path              text,
  -- reg. 425: all three limbs, stated, before 'not_required' is accepted.
  built_after_2003       boolean,
  none_identified        boolean,
  none_likely            boolean,
  -- reg. 429: the management plan, where asbestos is identified or presumed.
  plan_file_path         text,
  plan_date              date,
  superseded_by          uuid references public.asbestos_registers (id) on delete restrict,
  recorded_by            uuid references auth.users (id),
  created_at             timestamptz not null default now(),
  constraint asbestos_not_required_all_limbs check (
    status <> 'not_required' or (built_after_2003 is true and none_identified is true and none_likely is true)),
  constraint asbestos_not_required_none_present check (status <> 'not_required' or asbestos_present = false),
  constraint asbestos_plan_needs_date check (plan_file_path is null or plan_date is not null)
);
create index asbestos_registers_idx on public.asbestos_registers (project_id, register_date desc);

-- Who on the crew was told what the register says — recorded by whoever briefed them.
create table public.asbestos_acknowledgements (
  id           uuid primary key default gen_random_uuid(),
  register_id  uuid not null references public.asbestos_registers (id) on delete restrict,
  person_name  text not null check (length(btrim(person_name)) > 0),
  briefed_on   date not null,
  briefed_by   uuid references auth.users (id),
  created_at   timestamptz not null default now()
);
create unique index asbestos_ack_once_idx on public.asbestos_acknowledgements (register_id, lower(regexp_replace(btrim(person_name), '\s+', ' ', 'g')));

create table public.asbestos_removals (
  id                        uuid primary key default gen_random_uuid(),
  project_id                uuid not null references public.projects (id) on delete restrict,
  location                  text not null check (length(btrim(location)) > 0),
  friable                   boolean not null,
  area_m2                   numeric(8,1) check (area_m2 is null or area_m2 >= 0),
  removalist                text not null check (length(btrim(removalist)) > 0),
  licence_class             text not null check (licence_class in ('A', 'B')),
  licence_no                text not null check (length(btrim(licence_no)) > 0),
  emergency                 boolean not null default false,
  notified_worksafe_on      date not null,
  notification_reference    text,
  work_start_on             date not null,
  clearance_certificate     text,
  recorded_by               uuid references auth.users (id),
  created_at                timestamptz not null default now(),
  -- reg. 466: five days' notice before the work, unless it is an emergency.
  constraint asbestos_removal_notice check (emergency or notified_worksafe_on <= work_start_on - 5),
  -- Friable needs Class A.
  constraint asbestos_removal_friable_class_a check (not friable or licence_class = 'A')
);
create index asbestos_removals_idx on public.asbestos_removals (project_id, work_start_on desc);

create or replace function app.asbestos_registers_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.register_date > app.perth_today() then
      raise exception 'A register cannot be dated in the future.' using errcode = 'check_violation';
    end if;
    new.superseded_by := null;
    new.duty_holder := btrim(new.duty_holder);
    new.recorded_by := coalesce((select auth.uid()), new.recorded_by);
    new.created_at := now();
    return new;
  end if;
  -- The only change a register takes is being superseded by a newer one, once.
  if old.superseded_by is not null then
    raise exception 'A superseded register is frozen.' using errcode = 'check_violation';
  end if;
  if new.project_id is distinct from old.project_id or new.status is distinct from old.status or new.duty_holder is distinct from old.duty_holder
     or new.register_date is distinct from old.register_date or new.reference is distinct from old.reference or new.summary is distinct from old.summary
     or new.asbestos_present is distinct from old.asbestos_present or new.file_path is distinct from old.file_path
     or new.built_after_2003 is distinct from old.built_after_2003 or new.none_identified is distinct from old.none_identified
     or new.none_likely is distinct from old.none_likely or new.plan_file_path is distinct from old.plan_file_path
     or new.plan_date is distinct from old.plan_date or new.recorded_by is distinct from old.recorded_by or new.created_at is distinct from old.created_at then
    raise exception 'A register is superseded by a newer one, not rewritten.' using errcode = 'check_violation';
  end if;
  if new.superseded_by is not null and not exists (
    select 1 from public.asbestos_registers n where n.id = new.superseded_by and n.project_id = old.project_id and n.id <> old.id) then
    raise exception 'A register is superseded by a newer one on the same job.' using errcode = 'check_violation';
  end if;
  return new;
end; $$;
create trigger a_asbestos_registers_before_write before insert or update on public.asbestos_registers
  for each row execute function app.asbestos_registers_before_write();
create trigger a_asbestos_registers_no_delete before delete on public.asbestos_registers
  for each row execute function app.frozen_row();

create or replace function app.asbestos_acknowledgements_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.asbestos_registers r where r.id = new.register_id and r.superseded_by is not null) then
    raise exception 'Brief the crew on the register in force, not a superseded one.' using errcode = 'check_violation';
  end if;
  if new.briefed_on > app.perth_today() then
    raise exception 'A briefing cannot be dated in the future.' using errcode = 'check_violation';
  end if;
  new.person_name := regexp_replace(btrim(new.person_name), '\s+', ' ', 'g');
  new.briefed_by := coalesce((select auth.uid()), new.briefed_by);
  new.created_at := now();
  return new;
end; $$;
create trigger a_asbestos_acknowledgements_before_insert before insert on public.asbestos_acknowledgements
  for each row execute function app.asbestos_acknowledgements_before_insert();
create trigger a_asbestos_acknowledgements_no_update before update on public.asbestos_acknowledgements
  for each row execute function app.frozen_row();
create trigger a_asbestos_acknowledgements_no_delete before delete on public.asbestos_acknowledgements
  for each row execute function app.frozen_row();

create or replace function app.asbestos_removals_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- More than 10 m² of non-friable, or any friable, is licensed work; the class constraints cover which licence.
  if new.notified_worksafe_on > app.perth_today() then
    raise exception 'WorkSafe cannot have been notified in the future.' using errcode = 'check_violation';
  end if;
  new.recorded_by := coalesce((select auth.uid()), new.recorded_by);
  new.created_at := now();
  return new;
end; $$;
create trigger a_asbestos_removals_before_insert before insert on public.asbestos_removals
  for each row execute function app.asbestos_removals_before_insert();
create trigger a_asbestos_removals_no_update before update on public.asbestos_removals
  for each row execute function app.frozen_row();
create trigger a_asbestos_removals_no_delete before delete on public.asbestos_removals
  for each row execute function app.frozen_row();

create or replace function app.asbestos_register_project(p uuid) returns uuid language sql stable security definer set search_path = ''
as $$ select project_id from public.asbestos_registers where id = p $$;
grant execute on function app.asbestos_register_project(uuid) to authenticated;

alter table public.asbestos_registers enable row level security;
alter table public.asbestos_acknowledgements enable row level security;
alter table public.asbestos_removals enable row level security;

-- The register is kept readily accessible to workers (reg. 425): every member of the job reads it.
create policy asbestos_registers_select on public.asbestos_registers for select to authenticated using (app.is_project_member(project_id));
create policy asbestos_registers_insert on public.asbestos_registers for insert to authenticated with check (app.can_manage_incidents(project_id));
create policy asbestos_registers_update on public.asbestos_registers for update to authenticated using (app.can_manage_incidents(project_id)) with check (app.can_manage_incidents(project_id));
create policy asbestos_ack_select on public.asbestos_acknowledgements for select to authenticated using (app.is_project_member(app.asbestos_register_project(register_id)));
create policy asbestos_ack_insert on public.asbestos_acknowledgements for insert to authenticated with check (app.can_run_talks(app.asbestos_register_project(register_id)));
create policy asbestos_removals_select on public.asbestos_removals for select to authenticated using (app.is_project_member(project_id) and app.reads_record(project_id));
create policy asbestos_removals_insert on public.asbestos_removals for insert to authenticated with check (app.can_manage_incidents(project_id));

grant select, insert, update on public.asbestos_registers to authenticated;
grant select, insert on public.asbestos_acknowledgements, public.asbestos_removals to authenticated;
grant all on public.asbestos_registers, public.asbestos_acknowledgements, public.asbestos_removals to service_role;

-- The register documents and plans: {project_id}/{register_id}/{register|plan}.{ext}
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('asbestos-docs', 'asbestos-docs', false, 52428800,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'])
on conflict (id) do nothing;
create policy "asbestos documents readable by members" on storage.objects
  for select to authenticated
  using (bucket_id = 'asbestos-docs' and app.is_project_member(app.storage_project_id(name)));
create policy "asbestos documents writable by managers" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'asbestos-docs' and app.can_manage_incidents(app.storage_project_id(name)));
