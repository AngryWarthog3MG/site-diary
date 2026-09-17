-- ============================================================================
-- Second-agent review of health monitoring (R69) and names (R70) — README R78.
-- ============================================================================

-- 1. A keeper who has left the company keeps no access. The keeper row alone
--    was enough; now the keeper must also still be on a job of that company.
create or replace function app.is_health_keeper(p_org uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.health_record_keepers k
                  where k.org_id = p_org and k.user_id = (select auth.uid()) and k.active)
     and exists (select 1 from public.project_members pm
                   join public.projects p on p.id = pm.project_id
                  where p.org_id = p_org and pm.user_id = (select auth.uid()))
$$;

-- 2. Every appointment and revocation kept, not just the latest on one row.
create table public.health_keeper_events (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organisations (id) on delete restrict,
  user_id     uuid not null references auth.users (id) on delete restrict,
  kind        text not null check (kind in ('appointed', 'revoked')),
  by_user     uuid references auth.users (id),
  at          timestamptz not null default now()
);
create index health_keeper_events_idx on public.health_keeper_events (org_id, user_id, at);

-- What the keeper rows already say, as the first events.
insert into public.health_keeper_events (org_id, user_id, kind, by_user, at)
select org_id, user_id, 'appointed', granted_by, granted_at from public.health_record_keepers;
insert into public.health_keeper_events (org_id, user_id, kind, by_user, at)
select org_id, user_id, 'revoked', revoked_by, revoked_at from public.health_record_keepers where revoked_at is not null;

create or replace function app.health_record_keepers_log()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or (not old.active and new.active) then
    insert into public.health_keeper_events (org_id, user_id, kind, by_user, at) values (new.org_id, new.user_id, 'appointed', new.granted_by, new.granted_at);
  elsif old.active and not new.active then
    insert into public.health_keeper_events (org_id, user_id, kind, by_user, at) values (new.org_id, new.user_id, 'revoked', new.revoked_by, new.revoked_at);
  end if;
  return new;
end; $$;
create trigger b_health_record_keepers_log after insert or update on public.health_record_keepers
  for each row execute function app.health_record_keepers_log();
create trigger a_health_keeper_events_no_update before update on public.health_keeper_events
  for each row execute function app.frozen_row();
create trigger a_health_keeper_events_no_delete before delete on public.health_keeper_events
  for each row execute function app.frozen_row();

-- 3. A programme stays with its company; retiring or restoring it is stamped.
alter table public.health_monitoring_programs
  add column active_changed_by uuid references auth.users (id),
  add column active_changed_at timestamptz;

create or replace function app.health_programs_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce((select auth.uid()), new.created_by);
    new.created_at := now();
    new.active := true;
    new.active_changed_by := null; new.active_changed_at := null;
    return new;
  end if;
  if new.org_id is distinct from old.org_id or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception 'A monitoring programme stays with its company.' using errcode = 'check_violation';
  end if;
  if new.active is distinct from old.active then
    new.active_changed_by := coalesce((select auth.uid()), new.active_changed_by);
    new.active_changed_at := now();
  else
    new.active_changed_by := old.active_changed_by; new.active_changed_at := old.active_changed_at;
  end if;
  return new;
end; $$;
create trigger a_health_programs_before_write before insert or update on public.health_monitoring_programs
  for each row execute function app.health_programs_before_write();
create trigger a_health_programs_no_delete before delete on public.health_monitoring_programs
  for each row execute function app.frozen_row();

-- 4. A report file whose record was refused can be removed by a keeper — only a file no record names.
create policy "health reports unreferenced removable by keepers" on storage.objects
  for delete to authenticated
  using (bucket_id = 'health-records'
         and app.is_health_keeper(((storage.foldername(name))[1])::uuid)
         and not exists (select 1 from public.health_monitoring_records r where r.report_file_path = name));

-- 5. Monitoring ended for a person (left the company, moved off the work): recorded, so they stop
--    showing as due without a record of monitoring that never happened. Keepers only; frozen.
create table public.health_monitoring_ended (
  id           uuid primary key default gen_random_uuid(),
  program_id   uuid not null references public.health_monitoring_programs (id) on delete restrict,
  person_name  text not null check (length(btrim(person_name)) > 0),
  ended_on     date not null,
  reason       text not null check (length(btrim(reason)) > 0),
  recorded_by  uuid references auth.users (id),
  created_at   timestamptz not null default now()
);
create or replace function app.health_monitoring_ended_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.ended_on > app.perth_today() then
    raise exception 'Record it once it has ended.' using errcode = 'check_violation';
  end if;
  new.person_name := regexp_replace(btrim(new.person_name), '\s+', ' ', 'g');
  new.recorded_by := coalesce((select auth.uid()), new.recorded_by);
  new.created_at := now();
  return new;
end; $$;
create trigger a_health_monitoring_ended_before_insert before insert on public.health_monitoring_ended
  for each row execute function app.health_monitoring_ended_before_insert();
create trigger a_health_monitoring_ended_no_update before update on public.health_monitoring_ended
  for each row execute function app.frozen_row();
create trigger a_health_monitoring_ended_no_delete before delete on public.health_monitoring_ended
  for each row execute function app.frozen_row();
alter table public.health_monitoring_ended enable row level security;
create policy health_ended_select on public.health_monitoring_ended for select to authenticated
  using (app.is_health_keeper(app.health_program_org(program_id)));
create policy health_ended_insert on public.health_monitoring_ended for insert to authenticated
  with check (app.is_health_keeper(app.health_program_org(program_id)));
grant select, insert on public.health_monitoring_ended to authenticated;
grant all on public.health_monitoring_ended, public.health_keeper_events to service_role;

-- 6. A late lead risk notification is recorded with its true date and shows as late, rather than
--    being refused and inviting a false one. Never before the determination.
alter table public.lead_risk_notifications drop constraint lead_notified_within_7_days;
alter table public.lead_risk_notifications add constraint lead_notified_not_before_determined check (notified_on >= determined_on);

-- 8. Who the keepers are, and which programmes run, is known to everyone who reads the company's
--    record — a programme names a hazard, never a person. Reports stay keepers-only.
drop policy if exists health_keepers_select on public.health_record_keepers;
create policy health_keepers_select on public.health_record_keepers for select to authenticated
  using (app.is_org_admin(org_id) or app.is_health_keeper(org_id) or user_id = (select auth.uid())
         or (app.is_org_member(org_id) and app.reads_org_record(org_id)));
drop policy if exists health_programs_select on public.health_monitoring_programs;
create policy health_programs_select on public.health_monitoring_programs for select to authenticated
  using (app.is_health_keeper(org_id) or (app.is_org_member(org_id) and app.reads_org_record(org_id)));
alter table public.health_keeper_events enable row level security;
create policy health_keeper_events_select on public.health_keeper_events for select to authenticated
  using (app.is_org_admin(org_id) or app.is_health_keeper(org_id) or (app.is_org_member(org_id) and app.reads_org_record(org_id)));
grant select on public.health_keeper_events to authenticated;

-- 9. A name, once set, is changed by an admin, not by the person: the gate lets a labourer sign in
--    or out only rows carrying their own name, so a self-rename could sign a workmate in.
create or replace function app.profiles_name_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.full_name is not null and new.full_name is distinct from old.full_name
     and (select auth.uid()) is not null and (select auth.uid()) = old.id then
    raise exception 'Your name is set. Ask an admin to change it — the gate knows you by it.' using errcode = 'check_violation';
  end if;
  return new;
end; $$;
create trigger a_profiles_name_guard before update on public.profiles
  for each row execute function app.profiles_name_guard();
