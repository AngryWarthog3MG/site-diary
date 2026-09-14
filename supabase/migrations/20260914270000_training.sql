-- ============================================================================
-- Training and competency: what each role must hold, and what the company
-- itself certifies.
--
-- The ninth safety module. Tickets already live in crew_tickets, by person
-- and type. Two small tables turn them into a matrix: the competencies a
-- company defines for itself (its own induction, a refresher, a VOC it
-- runs), and the competencies each role must hold. From those and the
-- dates, the app says who is current, who is expiring, and who has a gap —
-- computed every time, never typed.
-- ============================================================================

create table public.org_competencies (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organisations (id) on delete restrict,
  key           text not null check (key ~ '^[a-z0-9_]{2,40}$'),
  label         text not null check (length(btrim(label)) > 0),
  valid_months  integer check (valid_months is null or (valid_months >= 1 and valid_months <= 120)),
  active        boolean not null default true,
  created_by    uuid references auth.users (id),
  created_at    timestamptz not null default now()
);
create unique index org_competencies_key_idx on public.org_competencies (org_id, key);

create table public.competency_requirements (
  org_id      uuid not null references public.organisations (id) on delete restrict,
  role        text not null check (length(btrim(role)) > 0),
  competency  text not null check (length(btrim(competency)) > 0),
  created_by  uuid references auth.users (id),
  created_at  timestamptz not null default now(),
  primary key (org_id, role, competency)
);

create or replace function app.competency_requirements_norm()
returns trigger language plpgsql set search_path = '' as $$
begin new.role := regexp_replace(lower(btrim(new.role)), '\s+', ' ', 'g'); new.competency := btrim(new.competency); return new; end; $$;
create trigger a_competency_requirements_norm before insert or update on public.competency_requirements
  for each row execute function app.competency_requirements_norm();

alter table public.org_competencies enable row level security;
alter table public.competency_requirements enable row level security;
create policy org_competencies_select_org on public.org_competencies
  for select to authenticated using (app.is_org_member(org_id));
create policy org_competencies_write_managers on public.org_competencies
  for all to authenticated using (app.can_manage_crew(org_id)) with check (app.can_manage_crew(org_id));
create policy competency_requirements_select_org on public.competency_requirements
  for select to authenticated using (app.is_org_member(org_id));
create policy competency_requirements_write_managers on public.competency_requirements
  for all to authenticated using (app.can_manage_crew(org_id)) with check (app.can_manage_crew(org_id));
grant select, insert, update, delete on public.org_competencies, public.competency_requirements to authenticated;
grant all on public.org_competencies, public.competency_requirements to service_role;
