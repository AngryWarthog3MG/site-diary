-- ============================================================================
-- Health monitoring: confidential records behind their own access tier.
--
-- WHS (General) Regulations 2022 (WA), Part 7.1 Division 6: health monitoring
-- is required for workers using, handling or storing a Schedule 14 hazardous
-- chemical where there is a significant risk to health, or where the risk
-- assessment otherwise shows it (reg. 368). It is supervised by a registered
-- medical practitioner. The reports are CONFIDENTIAL records, not disclosed
-- without the worker's written consent except as the regulations allow, and
-- kept for at least 30 years after the record is made (40 for asbestos-related
-- monitoring). Part 7.2 adds lead: lead risk work notified to the regulator
-- within 7 days of determining it, and health monitoring including biological
-- (blood lead) monitoring.
--
-- The research's warning (README R59, entry 07) shapes the app side: health
-- monitoring applies only where those triggers are met, so nothing here implies
-- it applies to all chemical work — a programme is set up deliberately, for a
-- named hazard, on a stated basis.
--
-- THE CONFIDENTIALITY TIER. Neither a role nor a screen tick is enough: a
-- supervisor who can see the training matrix must not thereby see a doctor's
-- report. So health records are readable and writable ONLY by the organisation's
-- named record keepers (health_record_keepers). An org admin appoints and removes
-- keepers but is not a keeper unless they appoint themselves — and that
-- appointment is itself on the record. The service role aside, nothing else can
-- read a report or its file.
-- ============================================================================

create table public.health_record_keepers (
  org_id      uuid not null references public.organisations (id) on delete restrict,
  user_id     uuid not null references auth.users (id) on delete restrict,
  active      boolean not null default true,
  granted_by  uuid references auth.users (id),
  granted_at  timestamptz not null default now(),
  revoked_by  uuid references auth.users (id),
  revoked_at  timestamptz,
  primary key (org_id, user_id)
);

create or replace function app.is_health_keeper(p_org uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.health_record_keepers k
                  where k.org_id = p_org and k.user_id = (select auth.uid()) and k.active)
$$;
grant execute on function app.is_health_keeper(uuid) to authenticated;

create or replace function app.health_record_keepers_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.active := true;
    new.granted_by := coalesce((select auth.uid()), new.granted_by);
    new.granted_at := now();
    new.revoked_by := null; new.revoked_at := null;
    return new;
  end if;
  if new.org_id is distinct from old.org_id or new.user_id is distinct from old.user_id then
    raise exception 'A keeper appointment stays with its person.' using errcode = 'check_violation';
  end if;
  if old.active and not new.active then
    new.revoked_by := coalesce((select auth.uid()), new.revoked_by);
    new.revoked_at := now();
    new.granted_by := old.granted_by; new.granted_at := old.granted_at;
  elsif not old.active and new.active then
    new.granted_by := coalesce((select auth.uid()), new.granted_by);
    new.granted_at := now();
    new.revoked_by := null; new.revoked_at := null;
  else
    new.granted_by := old.granted_by; new.granted_at := old.granted_at;
    new.revoked_by := old.revoked_by; new.revoked_at := old.revoked_at;
  end if;
  return new;
end; $$;
create trigger a_health_record_keepers_before_write before insert or update on public.health_record_keepers
  for each row execute function app.health_record_keepers_before_write();
create trigger a_health_record_keepers_no_delete before delete on public.health_record_keepers
  for each row execute function app.frozen_row();

create table public.health_monitoring_programs (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organisations (id) on delete restrict,
  hazard            text not null check (length(btrim(hazard)) > 0),
  basis             text not null check (basis in ('schedule_14', 'significant_risk', 'lead_risk_work', 'asbestos')),
  frequency_months  integer check (frequency_months is null or frequency_months between 1 and 60),
  practitioner      text,
  active            boolean not null default true,
  created_by        uuid references auth.users (id),
  created_at        timestamptz not null default now()
);

create table public.health_monitoring_records (
  id                uuid primary key default gen_random_uuid(),
  program_id        uuid not null references public.health_monitoring_programs (id) on delete restrict,
  person_name       text not null check (length(btrim(person_name)) > 0),
  monitored_on      date not null,
  practitioner      text not null check (length(btrim(practitioner)) > 0),
  result_summary    text,
  action_required   text,
  next_due_on       date,
  report_file_path  text,
  -- reg. 378: at least 30 years; 40 where the monitoring is for asbestos.
  retain_until      date not null,
  recorded_by       uuid references auth.users (id),
  created_at        timestamptz not null default now(),
  constraint health_next_after check (next_due_on is null or next_due_on > monitored_on)
);
create index health_monitoring_records_idx on public.health_monitoring_records (program_id, monitored_on desc);

create table public.lead_risk_notifications (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organisations (id) on delete restrict,
  project_id          uuid references public.projects (id) on delete restrict,
  description         text not null check (length(btrim(description)) > 0),
  determined_on       date not null,
  notified_on         date not null,
  reference           text,
  recorded_by         uuid references auth.users (id),
  created_at          timestamptz not null default now(),
  -- reg. 394: within 7 days of determining the work is lead risk work.
  constraint lead_notified_within_7_days check (notified_on >= determined_on and notified_on <= determined_on + 7)
);

create or replace function app.health_program_org(p uuid) returns uuid language sql stable security definer set search_path = ''
as $$ select org_id from public.health_monitoring_programs where id = p $$;
grant execute on function app.health_program_org(uuid) to authenticated;

create or replace function app.health_monitoring_records_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare b text;
begin
  select basis into b from public.health_monitoring_programs where id = new.program_id;
  if new.monitored_on > app.perth_today() then
    raise exception 'Monitoring cannot be recorded before it is done.' using errcode = 'check_violation';
  end if;
  new.retain_until := (new.monitored_on + make_interval(years => case when b = 'asbestos' then 40 else 30 end))::date;
  new.person_name := regexp_replace(btrim(new.person_name), '\s+', ' ', 'g');
  new.recorded_by := coalesce((select auth.uid()), new.recorded_by);
  new.created_at := now();
  return new;
end; $$;
create trigger a_health_monitoring_records_before_insert before insert on public.health_monitoring_records
  for each row execute function app.health_monitoring_records_before_insert();
create trigger a_health_monitoring_records_no_update before update on public.health_monitoring_records
  for each row execute function app.frozen_row();
create trigger a_health_monitoring_records_no_delete before delete on public.health_monitoring_records
  for each row execute function app.frozen_row();

create or replace function app.lead_risk_notifications_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.notified_on > app.perth_today() then
    raise exception 'The regulator cannot have been notified in the future.' using errcode = 'check_violation';
  end if;
  if new.project_id is not null and not exists (select 1 from public.projects p where p.id = new.project_id and p.org_id = new.org_id) then
    raise exception 'That job is not in this organisation.' using errcode = 'check_violation';
  end if;
  new.recorded_by := coalesce((select auth.uid()), new.recorded_by);
  new.created_at := now();
  return new;
end; $$;
create trigger a_lead_risk_notifications_before_insert before insert on public.lead_risk_notifications
  for each row execute function app.lead_risk_notifications_before_insert();
create trigger a_lead_risk_notifications_no_update before update on public.lead_risk_notifications
  for each row execute function app.frozen_row();
create trigger a_lead_risk_notifications_no_delete before delete on public.lead_risk_notifications
  for each row execute function app.frozen_row();

alter table public.health_record_keepers enable row level security;
alter table public.health_monitoring_programs enable row level security;
alter table public.health_monitoring_records enable row level security;
alter table public.lead_risk_notifications enable row level security;

-- Who the keepers are is known to the org's admins and to the keepers themselves.
create policy health_keepers_select on public.health_record_keepers for select to authenticated
  using (app.is_org_admin(org_id) or app.is_health_keeper(org_id) or user_id = (select auth.uid()));
create policy health_keepers_insert on public.health_record_keepers for insert to authenticated with check (app.is_org_admin(org_id));
create policy health_keepers_update on public.health_record_keepers for update to authenticated
  using (app.is_org_admin(org_id)) with check (app.is_org_admin(org_id));

-- A programme names a hazard, not a person: crew managers see it and set it up; keepers see it too.
create policy health_programs_select on public.health_monitoring_programs for select to authenticated
  using (app.can_manage_crew(org_id) or app.is_health_keeper(org_id));
create policy health_programs_write on public.health_monitoring_programs for all to authenticated
  using (app.can_manage_crew(org_id)) with check (app.can_manage_crew(org_id));

-- THE TIER: a record, and who it is about, is read and written by keepers only.
create policy health_records_select on public.health_monitoring_records for select to authenticated
  using (app.is_health_keeper(app.health_program_org(program_id)));
create policy health_records_insert on public.health_monitoring_records for insert to authenticated
  with check (app.is_health_keeper(app.health_program_org(program_id)));

-- A notification to the regulator is about work, not a person.
create policy lead_notifications_select on public.lead_risk_notifications for select to authenticated
  using (app.can_manage_crew(org_id) or app.is_health_keeper(org_id));
create policy lead_notifications_insert on public.lead_risk_notifications for insert to authenticated
  with check (app.can_manage_crew(org_id));

grant select, insert, update on public.health_record_keepers, public.health_monitoring_programs to authenticated;
grant select, insert on public.health_monitoring_records, public.lead_risk_notifications to authenticated;
grant all on public.health_record_keepers, public.health_monitoring_programs, public.health_monitoring_records, public.lead_risk_notifications to service_role;

-- Reports: {org_id}/{program_id}/{record_id}.{ext}. Keepers only, in and out.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('health-records', 'health-records', false, 20971520,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'])
on conflict (id) do nothing;
create policy "health reports readable by keepers" on storage.objects
  for select to authenticated
  using (bucket_id = 'health-records' and app.is_health_keeper(((storage.foldername(name))[1])::uuid));
create policy "health reports writable by keepers" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'health-records' and app.is_health_keeper(((storage.foldername(name))[1])::uuid));
