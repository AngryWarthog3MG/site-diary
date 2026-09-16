-- ============================================================================
-- Scheduled obligations: the things that fall due on a cycle, and the evidence
-- that each one happened on time.
--
-- The certification research (README R59) found nine of the eleven gaps are
-- the same object — an internal audit due, a management review due, an
-- emergency drill due, a safety data sheet up for review, a five-yearly plan
-- review, a ticket expiring, a plant inspection, a hold point awaiting release,
-- a non-conformance awaiting close-out. A surveillance auditor asks the same
-- question of every one: show me the schedule, and show me each one happened
-- when it was meant to.
--
-- Two kinds, and only one needs a table:
--
--   DERIVED obligations are read off records the app already keeps — a
--   sheet's issue date, a ticket's expiry. Storing a copy would let the two
--   disagree. They are computed in src/lib/obligations/load.ts, never stored.
--
--   SCHEDULED obligations exist only as a schedule: "audit this job at most
--   every three months". Those live here, with their completions.
--
-- A completion is a record: dated, attributed, never rewritten or deleted. It
-- names the occurrence it discharges (due_on) and when it was actually done
-- (done_on), so "was it on time" is a fact of the row, not a later opinion.
-- The next occurrence is counted from when the last one was DONE, because
-- that is how a maximum interval is audited: Main Roads WA Specification 201
-- cl. 201.12.03 requires audits "at a maximum of three-monthly intervals",
-- which is a limit on the gap between two audits, not a calendar.
-- ============================================================================

create table public.obligations (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organisations (id) on delete restrict,
  -- Null for a company-wide obligation such as the organisation's management
  -- review (ISO cl. 9.3 is organisation-level); set for one job's.
  project_id       uuid references public.projects (id) on delete restrict,
  kind             text not null check (kind in (
                     'internal_audit', 'management_review', 'emergency_drill',
                     'compliance_evaluation', 'plan_review', 'inspection', 'other')),
  title            text not null check (length(btrim(title)) > 0),
  -- Why it is due, in the words of what requires it: "ISO 45001 cl. 9.2",
  -- "reg. 43(1)(b)", "Main Roads Spec 201 cl. 201.12.03". Shown on every row.
  basis            text,
  -- Months between occurrences. Null means it happens once.
  interval_months  integer check (interval_months is null or interval_months between 1 and 120),
  first_due_on     date not null,
  owner_id         uuid references auth.users (id),
  active           boolean not null default true,
  created_by       uuid references auth.users (id),
  created_at       timestamptz not null default now(),
  constraint obligations_project_in_org check (project_id is null or org_id is not null)
);
create index obligations_scope_idx on public.obligations (org_id, project_id, active);

create table public.obligation_completions (
  id              uuid primary key default gen_random_uuid(),
  obligation_id   uuid not null references public.obligations (id) on delete restrict,
  -- The occurrence this discharges, as it was due at the time.
  due_on          date not null,
  -- When it was actually done. Never later than today; the DB checks.
  done_on         date not null,
  done_by         uuid references auth.users (id),
  -- What shows it happened: a note, and optionally a reference to the record
  -- that is the evidence (an inspection, a document version, a report).
  evidence_note   text not null check (length(btrim(evidence_note)) > 0),
  evidence_ref    text,
  created_at      timestamptz not null default now()
);
create index obligation_completions_idx on public.obligation_completions (obligation_id, done_on desc);

-- An obligation's project must belong to its organisation.
create or replace function app.obligations_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.project_id is not null and not exists (
    select 1 from public.projects p where p.id = new.project_id and p.org_id = new.org_id
  ) then
    raise exception 'That job is not in this organisation.' using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' and (new.org_id is distinct from old.org_id or new.project_id is distinct from old.project_id
     or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at) then
    raise exception 'An obligation cannot move between jobs or companies.' using errcode = 'check_violation';
  end if;
  return new;
end; $$;
create trigger a_obligations_before_write before insert or update on public.obligations
  for each row execute function app.obligations_before_write();

-- A completion is stamped by the database and then frozen.
create or replace function app.obligation_completions_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.done_by := (select auth.uid());
  new.created_at := now();
  if new.done_on > (now() at time zone 'Australia/Perth')::date then
    raise exception 'It cannot have been done in the future.' using errcode = 'check_violation';
  end if;
  new.evidence_note := btrim(new.evidence_note);
  return new;
end; $$;
create trigger a_obligation_completions_before_insert before insert on public.obligation_completions
  for each row execute function app.obligation_completions_before_insert();
create trigger a_obligation_completions_no_update before update on public.obligation_completions
  for each row execute function app.frozen_row();
create trigger a_obligation_completions_no_delete before delete on public.obligation_completions
  for each row execute function app.frozen_row();
-- An obligation with any completion is history: retire it, never delete it.
create trigger a_obligations_no_delete before delete on public.obligations
  for each row execute function app.frozen_row();

create or replace function app.obligation_manageable(p_org uuid, p_project uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select case when p_project is null then app.can_manage_crew(p_org) else app.can_manage_incidents(p_project) end
$$;
grant execute on function app.obligation_manageable(uuid, uuid) to authenticated;

create or replace function app.obligation_readable(p_org uuid, p_project uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select case when p_project is null then app.is_org_member(p_org) and app.reads_org_record(p_org)
              else app.is_project_member(p_project) and app.reads_record(p_project) end
$$;
grant execute on function app.obligation_readable(uuid, uuid) to authenticated;

create or replace function app.obligation_scope(p_obligation uuid)
returns table (org_id uuid, project_id uuid) language sql stable security definer set search_path = ''
as $$ select o.org_id, o.project_id from public.obligations o where o.id = p_obligation $$;
grant execute on function app.obligation_scope(uuid) to authenticated;

alter table public.obligations enable row level security;
alter table public.obligation_completions enable row level security;

-- A schedule of audits and reviews is management information, not the gate: a
-- labourer does not read it (app.reads_record / reads_org_record refuse them).
create policy obligations_select on public.obligations
  for select to authenticated using (app.obligation_readable(org_id, project_id));
create policy obligations_insert on public.obligations
  for insert to authenticated with check (app.obligation_manageable(org_id, project_id));
create policy obligations_update on public.obligations
  for update to authenticated using (app.obligation_manageable(org_id, project_id))
  with check (app.obligation_manageable(org_id, project_id));

create policy obligation_completions_select on public.obligation_completions
  for select to authenticated using (
    exists (select 1 from app.obligation_scope(obligation_id) s where app.obligation_readable(s.org_id, s.project_id)));
create policy obligation_completions_insert on public.obligation_completions
  for insert to authenticated with check (
    exists (select 1 from app.obligation_scope(obligation_id) s where app.obligation_manageable(s.org_id, s.project_id)));

grant select, insert, update on public.obligations to authenticated;
grant select, insert on public.obligation_completions to authenticated;
grant all on public.obligations, public.obligation_completions to service_role;
