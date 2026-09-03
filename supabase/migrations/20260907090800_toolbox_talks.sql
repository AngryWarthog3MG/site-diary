-- ============================================================================
-- 20260907090800_toolbox_talks.sql
-- Toolbox talks: the weekly safety talk as a record.
--
-- A talk is drafted by a supervisor or admin (topic, summary, presenter),
-- the crew sign on glass one after another on the supervisor's phone, and
-- completing the talk freezes it — the same immutability ethos as the diary,
-- enforced by triggers, not the UI. Talks are their own record; they do not
-- touch entries or the entry hash.
-- ============================================================================

create table public.toolbox_talks (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.projects (id) on delete restrict,
  talk_date      date not null,
  topic          text not null check (length(btrim(topic)) > 0),
  summary        text not null check (length(btrim(summary)) > 0),
  presenter_name text not null check (length(btrim(presenter_name)) > 0),
  conducted_by   uuid not null references auth.users (id),
  completed_at   timestamptz,
  created_at     timestamptz not null default now()
);

create index toolbox_talks_project_idx on public.toolbox_talks (project_id, talk_date desc);

create table public.toolbox_attendees (
  id             uuid primary key default gen_random_uuid(),
  talk_id        uuid not null references public.toolbox_talks (id) on delete cascade,
  attendee_name  text not null check (length(btrim(attendee_name)) > 0),
  signature_path text not null,
  created_at     timestamptz not null default now()
);

create index toolbox_attendees_talk_idx on public.toolbox_attendees (talk_id);

-- Who may run talks: the people who can author diary entries.
create or replace function app.can_run_talks(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.project_members pm
     where pm.project_id = p_project
       and pm.user_id = auth.uid()
       and pm.role in ('supervisor', 'admin')
  );
$$;

create or replace function app.can_write_talk(p_talk uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.toolbox_talks t
     where t.id = p_talk
       and t.completed_at is null
       and app.can_run_talks(t.project_id)
  );
$$;

alter table public.toolbox_talks enable row level security;
alter table public.toolbox_attendees enable row level security;

create policy toolbox_talks_select_member on public.toolbox_talks
  for select to authenticated using (app.is_project_member(project_id));

create policy toolbox_talks_insert_author on public.toolbox_talks
  for insert to authenticated
  with check (conducted_by = (select auth.uid()) and app.can_run_talks(project_id));

create policy toolbox_talks_update_open on public.toolbox_talks
  for update to authenticated
  using (completed_at is null and app.can_run_talks(project_id))
  with check (app.can_run_talks(project_id));

create policy toolbox_talks_delete_open on public.toolbox_talks
  for delete to authenticated
  using (completed_at is null and app.can_run_talks(project_id));

create policy toolbox_attendees_select_member on public.toolbox_attendees
  for select to authenticated
  using (exists (select 1 from public.toolbox_talks t
                  where t.id = talk_id and app.is_project_member(t.project_id)));

create policy toolbox_attendees_insert_open on public.toolbox_attendees
  for insert to authenticated with check (app.can_write_talk(talk_id));

create policy toolbox_attendees_delete_open on public.toolbox_attendees
  for delete to authenticated using (app.can_write_talk(talk_id));

-- A completed talk is a record: nothing changes, nothing leaves.
create or replace function app.toolbox_enforce_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'toolbox_talks' then
    if old.completed_at is not null then
      raise exception 'This toolbox talk is completed and cannot be modified.'
        using errcode = 'check_violation';
    end if;
  else
    if exists (select 1 from public.toolbox_talks t
                where t.id = coalesce(new.talk_id, old.talk_id)
                  and t.completed_at is not null) then
      raise exception 'This toolbox talk is completed; attendance cannot change.'
        using errcode = 'check_violation';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

create trigger toolbox_talks_immutable
  before update or delete on public.toolbox_talks
  for each row execute function app.toolbox_enforce_immutable();

create trigger toolbox_attendees_immutable
  before insert or update or delete on public.toolbox_attendees
  for each row execute function app.toolbox_enforce_immutable();

grant select, insert, update, delete on public.toolbox_talks to authenticated;
grant select, insert, delete on public.toolbox_attendees to authenticated;
grant all on public.toolbox_talks, public.toolbox_attendees to service_role;

-- Signature images live under {project}/toolbox/{talk}/… in entry-photos;
-- the existing per-entry write policy cannot see them, so they get their own.
create policy "toolbox signatures writable while talk open" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'entry-photos'
    and (storage.foldername(name))[2] = 'toolbox'
    and app.can_write_talk(((storage.foldername(name))[3])::uuid)
  );
