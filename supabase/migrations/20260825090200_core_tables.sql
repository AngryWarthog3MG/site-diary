-- ============================================================================
-- 20260825090200_core_tables.sql
-- Organisations, projects, project membership.
-- ============================================================================

create table public.organisations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(btrim(name)) > 0),
  -- Short prefix used to build entry numbers, e.g. KBS in KBS_C001_DD_142.
  code       text not null unique check (code ~ '^[A-Z0-9]{2,8}$'),
  created_at timestamptz not null default now()
);

create table public.projects (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references public.organisations (id) on delete restrict,
  name                 text not null check (length(btrim(name)) > 0),
  -- Project segment of the entry number, e.g. C001 in KBS_C001_DD_142.
  code                 text not null check (code ~ '^[A-Z0-9]{2,12}$'),
  site_lat             double precision check (site_lat between -90 and 90),
  site_lng             double precision check (site_lng between -180 and 180),
  bom_station_id       text,
  principal_contractor text,
  active               boolean not null default true,
  -- Per-project entry counter. Advanced under row lock by the numbering
  -- trigger so concurrent supervisors cannot collide on a serial.
  next_entry_seq       integer not null default 1 check (next_entry_seq >= 1),
  created_at           timestamptz not null default now(),
  unique (org_id, code)
);

comment on column public.projects.next_entry_seq is
  'Next entry_seq to hand out. Managed by app.assign_entry_no(); do not set by hand.';

create table public.project_members (
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  role       public.member_role not null,
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create index project_members_user_id_idx on public.project_members (user_id);
create index projects_org_id_idx          on public.projects (org_id);
