-- ============================================================================
-- 20260907091000_prestarts.sql
-- The daily prestart: what is on today, what could hurt someone, who is
-- here and fit to work — and everyone's signature saying they heard it.
--
-- Same shape as toolbox talks, because it is the same kind of record: a
-- supervisor writes it, the crew sign on glass one after another, and
-- finishing it freezes it. Triggers enforce that, not the UI. Prestarts are
-- their own record; they do not touch entries or the entry hash.
-- ============================================================================

create table public.prestarts (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects (id) on delete restrict,
  prestart_date   date not null,
  supervisor_name text not null check (length(btrim(supervisor_name)) > 0),
  work_planned    text not null check (length(btrim(work_planned)) > 0),
  hazards         text not null check (length(btrim(hazards)) > 0),
  plant           text,
  permits         text,
  notes           text,
  -- Standard items, each answered yes/no. Keys are fixed in the app; the
  -- record keeps whatever was answered on the day.
  checklist       jsonb not null default '{}'::jsonb,
  conducted_by    uuid not null references auth.users (id),
  completed_at    timestamptz,
  created_at      timestamptz not null default now()
);

create index prestarts_project_idx on public.prestarts (project_id, prestart_date desc);

create table public.prestart_attendees (
  id             uuid primary key default gen_random_uuid(),
  prestart_id    uuid not null references public.prestarts (id) on delete cascade,
  attendee_name  text not null check (length(btrim(attendee_name)) > 0),
  -- Each person answers for themselves as they sign: fit, or not.
  fit_for_work   boolean not null default true,
  signature_path text not null,
  created_at     timestamptz not null default now()
);

create index prestart_attendees_prestart_idx on public.prestart_attendees (prestart_id);

-- The same people who run toolbox talks run prestarts.
create or replace function app.can_write_prestart(p_prestart uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.prestarts s
     where s.id = p_prestart
       and s.completed_at is null
       and app.can_run_talks(s.project_id)
  );
$$;

alter table public.prestarts enable row level security;
alter table public.prestart_attendees enable row level security;

create policy prestarts_select_member on public.prestarts
  for select to authenticated using (app.is_project_member(project_id));

create policy prestarts_insert_author on public.prestarts
  for insert to authenticated
  with check (conducted_by = (select auth.uid()) and app.can_run_talks(project_id));

create policy prestarts_update_open on public.prestarts
  for update to authenticated
  using (completed_at is null and app.can_run_talks(project_id))
  with check (app.can_run_talks(project_id));

create policy prestarts_delete_open on public.prestarts
  for delete to authenticated
  using (completed_at is null and app.can_run_talks(project_id));

create policy prestart_attendees_select_member on public.prestart_attendees
  for select to authenticated
  using (exists (select 1 from public.prestarts s
                  where s.id = prestart_id and app.is_project_member(s.project_id)));

create policy prestart_attendees_insert_open on public.prestart_attendees
  for insert to authenticated with check (app.can_write_prestart(prestart_id));

create policy prestart_attendees_delete_open on public.prestart_attendees
  for delete to authenticated using (app.can_write_prestart(prestart_id));

-- A finished prestart is a record: nothing changes, nothing leaves.
create or replace function app.prestart_enforce_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'prestarts' then
    if old.completed_at is not null then
      raise exception 'This prestart is finished and cannot be modified.'
        using errcode = 'check_violation';
    end if;
  else
    if exists (select 1 from public.prestarts s
                where s.id = coalesce(new.prestart_id, old.prestart_id)
                  and s.completed_at is not null) then
      raise exception 'This prestart is finished; attendance cannot change.'
        using errcode = 'check_violation';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

create trigger prestarts_immutable
  before update or delete on public.prestarts
  for each row execute function app.prestart_enforce_immutable();

create trigger prestart_attendees_immutable
  before insert or update or delete on public.prestart_attendees
  for each row execute function app.prestart_enforce_immutable();

grant select, insert, update, delete on public.prestarts to authenticated;
grant select, insert, delete on public.prestart_attendees to authenticated;
grant all on public.prestarts, public.prestart_attendees to service_role;

-- Signature images live under {project}/prestart/{prestart}/… in entry-photos.
create policy "prestart signatures writable while open" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'entry-photos'
    and (storage.foldername(name))[2] = 'prestart'
    and app.can_write_prestart(((storage.foldername(name))[3])::uuid)
  );
