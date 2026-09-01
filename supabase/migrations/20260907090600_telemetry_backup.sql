-- ============================================================================
-- 20260907090600_telemetry_backup.sql
-- Ops resilience: client error telemetry and the monthly-send marker.
--
-- client_errors is operational exhaust, not record: capped fields, written by
-- the erroring user's own session, read only by the service role, trimmed by
-- the nightly sweep.
-- ============================================================================

create table public.client_errors (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users (id) on delete set null,
  path        text check (length(path) <= 300),
  message     text not null check (length(message) <= 1000),
  stack       text check (length(stack) <= 4000),
  user_agent  text check (length(user_agent) <= 300),
  occurred_at timestamptz not null default now()
);

create index client_errors_occurred_idx on public.client_errors (occurred_at desc);

alter table public.client_errors enable row level security;

create policy client_errors_insert_own on public.client_errors
  for insert to authenticated
  with check (user_id = (select auth.uid()));

-- No select policy for users: telemetry flows one way, to the operator.

grant insert on public.client_errors to authenticated;
grant all on public.client_errors to service_role;

alter table public.projects
  add column monthly_report_last_sent date;
