-- ============================================================================
-- Tickets and inductions.
--
-- Two ticks on the prestart said "SWMS reviewed" and "everyone fit and
-- inducted" with nothing behind them, and the plant prestart took any name as
-- an operator. Now the company keeps each person's tickets — white card,
-- licences, plant tickets, first aid — with their expiry, and each job keeps
-- who has been inducted onto it. The plant prestart refuses an operator whose
-- recorded tickets do not cover the machine, and the crew prestart marks a
-- sign-on from someone not yet inducted on the job.
--
-- People are named, not accounts: the diary, the sign-ons and the labour rows
-- all work by name, so tickets do too — per organisation, matched on the
-- name as typed, case-insensitively.
-- ============================================================================

create or replace function app.can_manage_crew(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.project_members pm
      join public.projects p on p.id = pm.project_id
     where p.org_id = p_org_id
       and pm.user_id = auth.uid()
       and pm.role in ('supervisor', 'admin')
  );
$$;
grant execute on function app.can_manage_crew(uuid) to authenticated;

create table public.crew_tickets (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organisations (id) on delete restrict,
  person_name  text not null check (length(btrim(person_name)) > 0),
  -- Fixed in the app: white_card, c_licence, mr_licence, hr_licence, hc_licence,
  -- excavator, roller, loader, forklift, ewp, first_aid, working_at_heights,
  -- confined_space, traffic_control, chainsaw, other. The record keeps the text.
  ticket_type  text not null,
  ticket_no    text,
  issued_on    date,
  expires_on   date,
  photo_path   text,
  notes        text,
  active       boolean not null default true,
  created_by   uuid references auth.users (id),
  created_at   timestamptz not null default now()
);
create index crew_tickets_person_idx on public.crew_tickets (org_id, lower(person_name), active);

create table public.crew_inductions (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects (id) on delete cascade,
  person_name  text not null check (length(btrim(person_name)) > 0),
  inducted_on  date not null default (now() at time zone 'Australia/Perth')::date,
  inducted_by  uuid not null references auth.users (id),
  notes        text,
  created_at   timestamptz not null default now()
);
create unique index crew_inductions_one_per_person_idx on public.crew_inductions (project_id, lower(person_name));

alter table public.crew_tickets enable row level security;
alter table public.crew_inductions enable row level security;

create policy crew_tickets_select_org on public.crew_tickets
  for select to authenticated using (app.is_org_member(org_id));
create policy crew_tickets_write_managers on public.crew_tickets
  for all to authenticated
  using (app.can_manage_crew(org_id)) with check (app.can_manage_crew(org_id));

create policy crew_inductions_select_member on public.crew_inductions
  for select to authenticated using (app.is_project_member(project_id));
-- Inducting someone onto the job happens on the day, by whoever runs the prestart.
create policy crew_inductions_write_crew on public.crew_inductions
  for all to authenticated
  using (app.can_run_talks(project_id))
  with check (inducted_by = (select auth.uid()) and app.can_run_talks(project_id));

grant select, insert, update, delete on public.crew_tickets to authenticated;
grant select, insert, update, delete on public.crew_inductions to authenticated;
grant all on public.crew_tickets, public.crew_inductions to service_role;

-- Ticket photos: {org_id}/{ticket_id}.jpg, readable across the organisation.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('crew-tickets', 'crew-tickets', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'])
on conflict (id) do nothing;

create policy "ticket photos readable by the organisation" on storage.objects
  for select to authenticated
  using (bucket_id = 'crew-tickets' and app.is_org_member(((storage.foldername(name))[1])::uuid));
create policy "ticket photos writable by crew managers" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'crew-tickets' and app.can_manage_crew(((storage.foldername(name))[1])::uuid));
create policy "ticket photos replaceable by crew managers" on storage.objects
  for update to authenticated
  using (bucket_id = 'crew-tickets' and app.can_manage_crew(((storage.foldername(name))[1])::uuid))
  with check (bucket_id = 'crew-tickets' and app.can_manage_crew(((storage.foldername(name))[1])::uuid));
