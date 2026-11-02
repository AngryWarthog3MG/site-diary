-- The action register (README R177): one register over every action the app raises, wherever it came from.
--
-- Until now an action lived on the record that raised it — an incident's corrective actions, an inspection's,
-- an audit finding's, a management review's, a compliance evaluation's — and the only places they met were the
-- Safety dashboard (two of the five) and What's due (three of the five). Stems has one action register, and
-- that is the half of it a supervisor actually opens: everything assigned to me, everything overdue on my job.
--
-- Three things here, and none of them moves a row:
--   1. `public.actions` — MANUAL actions, raised against a job or the whole company, with no record behind them.
--   2. `priority` and `assigned_to` on the five action tables that exist, so an action of any origin can be
--      given to an ACCOUNT (for "my actions" and a push) at a priority. Each table's own freeze still stands:
--      a done action is frozen, and an issued audit's finding changes only in these two and its done stamp.
--   3. `public.action_register` — a security_invoker view that unions the six, in one shape. Each base table's
--      RLS decides what a caller sees through it; the view adds no read of its own.
-- `update_action` and `complete_action` dispatch to the right table by origin, as the caller (security invoker),
-- so the screen has one call and every table's policy and trigger still has the last word.

-- ---------------------------------------------------------------------------
-- 1. Manual actions.
-- ---------------------------------------------------------------------------
create table public.actions (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organisations (id) on delete restrict,
  -- Null = company-wide, for the office; set = this job's.
  project_id   uuid references public.projects (id) on delete restrict,
  action       text not null check (length(btrim(action)) > 0),
  detail       text,
  priority     text not null default 'normal' check (priority in ('normal', 'high', 'critical')),
  -- The name on the sheets, for someone with no login; assigned_to is the account.
  owner_name   text,
  assigned_to  uuid references auth.users (id),
  assigned_at  timestamptz,
  due_on       date,
  done_at      timestamptz,
  done_by      uuid references auth.users (id),
  done_note    text,
  raised_by    uuid not null references auth.users (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index actions_project_idx on public.actions (project_id, done_at, due_on);
create index actions_org_idx on public.actions (org_id, done_at, due_on);
create index actions_assigned_idx on public.actions (assigned_to, done_at);

-- The same two columns on the actions that records raise.
alter table public.incident_actions
  add column priority text not null default 'normal' check (priority in ('normal', 'high', 'critical')),
  add column assigned_to uuid references auth.users (id);
alter table public.inspection_actions
  add column priority text not null default 'normal' check (priority in ('normal', 'high', 'critical')),
  add column assigned_to uuid references auth.users (id);
alter table public.audit_findings
  add column priority text not null default 'normal' check (priority in ('normal', 'high', 'critical')),
  add column assigned_to uuid references auth.users (id);
alter table public.review_actions
  add column priority text not null default 'normal' check (priority in ('normal', 'high', 'critical')),
  add column assigned_to uuid references auth.users (id);
alter table public.compliance_evaluation_results
  add column priority text not null default 'normal' check (priority in ('normal', 'high', 'critical')),
  add column assigned_to uuid references auth.users (id);
create index incident_actions_assigned_idx on public.incident_actions (assigned_to) where done_at is null;
create index inspection_actions_assigned_idx on public.inspection_actions (assigned_to) where done_at is null;
create index audit_findings_assigned_idx on public.audit_findings (assigned_to) where done_at is null;
create index review_actions_assigned_idx on public.review_actions (assigned_to) where done_at is null;
create index compliance_results_assigned_idx on public.compliance_evaluation_results (assigned_to) where done_at is null;

-- An assignee is a member of the job, or of some job of the company when the action is company-wide.
create or replace function app.action_assignee_ok(p_org uuid, p_project uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_user is null or exists (
    select 1 from public.project_members pm
      join public.projects p on p.id = pm.project_id
     where pm.user_id = p_user and p.org_id = p_org and (p_project is null or pm.project_id = p_project)
  );
$$;

create or replace function app.actions_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.action := btrim(new.action);
  new.detail := nullif(btrim(coalesce(new.detail, '')), '');
  new.owner_name := nullif(btrim(coalesce(new.owner_name, '')), '');
  new.done_note := nullif(btrim(coalesce(new.done_note, '')), '');
  if new.project_id is not null and not exists (select 1 from public.projects p where p.id = new.project_id and p.org_id = new.org_id) then
    raise exception 'That job is not in this organisation.' using errcode = 'check_violation';
  end if;
  if not app.action_assignee_ok(new.org_id, new.project_id, new.assigned_to) then
    raise exception 'An action is assigned to someone on the job.' using errcode = 'check_violation';
  end if;
  if tg_op = 'INSERT' then
    new.raised_by := coalesce(auth.uid(), new.raised_by);
    new.created_at := now(); new.updated_at := now();
    new.assigned_at := case when new.assigned_to is null then null else now() end;
    new.done_at := null; new.done_by := null; new.done_note := null;
    return new;
  end if;
  if old.done_at is not null then
    raise exception 'A done action is frozen.' using errcode = 'check_violation';
  end if;
  if new.org_id is distinct from old.org_id or new.project_id is distinct from old.project_id
     or new.raised_by is distinct from old.raised_by or new.created_at is distinct from old.created_at then
    raise exception 'An action stays where it was raised.' using errcode = 'check_violation';
  end if;
  if new.assigned_to is distinct from old.assigned_to then
    new.assigned_at := case when new.assigned_to is null then null else now() end;
  else
    new.assigned_at := old.assigned_at;
  end if;
  if new.done_at is not null then
    new.done_at := now();
    new.done_by := coalesce(auth.uid(), new.done_by);
  else
    new.done_by := null; new.done_note := null;
  end if;
  new.updated_at := now();
  return new;
end; $$;
create trigger a_actions_before_write before insert or update on public.actions
  for each row execute function app.actions_before_write();

create or replace function app.actions_before_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.done_at is not null then
    raise exception 'A done action is part of the record and is not removed.' using errcode = 'check_violation';
  end if;
  return old;
end; $$;
create trigger a_actions_before_delete before delete on public.actions
  for each row execute function app.actions_before_delete();

-- The assignee on the other five must be on the job too. One trigger, five tables; it reads the job off the
-- parent record. It runs AFTER each table's own before-write (named a_…), so a frozen row is refused first.
create or replace function app.action_assignee_check()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_project uuid;
begin
  if new.assigned_to is null then return new; end if;
  if tg_table_name = 'incident_actions' then
    select p.org_id, i.project_id into v_org, v_project from public.incidents i join public.projects p on p.id = i.project_id where i.id = new.incident_id;
  elsif tg_table_name = 'inspection_actions' then
    select p.org_id, i.project_id into v_org, v_project from public.inspections i join public.projects p on p.id = i.project_id where i.id = new.inspection_id;
  elsif tg_table_name = 'audit_findings' then
    select a.org_id, a.project_id into v_org, v_project from public.audits a where a.id = new.audit_id;
  elsif tg_table_name = 'review_actions' then
    select r.org_id, r.project_id into v_org, v_project from public.management_reviews r where r.id = new.review_id;
  elsif tg_table_name = 'compliance_evaluation_results' then
    select e.org_id, e.project_id into v_org, v_project from public.compliance_evaluations e where e.id = new.evaluation_id;
  end if;
  if not app.action_assignee_ok(v_org, v_project, new.assigned_to) then
    raise exception 'An action is assigned to someone on the job.' using errcode = 'check_violation';
  end if;
  return new;
end; $$;
create trigger b_incident_actions_assignee before insert or update on public.incident_actions for each row execute function app.action_assignee_check();
create trigger b_inspection_actions_assignee before insert or update on public.inspection_actions for each row execute function app.action_assignee_check();
create trigger b_audit_findings_assignee before insert or update on public.audit_findings for each row execute function app.action_assignee_check();
create trigger b_review_actions_assignee before insert or update on public.review_actions for each row execute function app.action_assignee_check();
create trigger b_compliance_results_assignee before insert or update on public.compliance_evaluation_results for each row execute function app.action_assignee_check();

-- ---------------------------------------------------------------------------
-- Access to manual actions. Raising on a job = anyone who runs the site (app.can_run_talks); company-wide =
-- the office (app.can_manage_crew). Updating an open one = a manager of the job, or the person it is assigned
-- to, or whoever raised it. Removing an open one = whoever raised it. Reads follow the record (the labourer
-- reads none of it — the register is not one of their doors).
-- ---------------------------------------------------------------------------
alter table public.actions enable row level security;
create policy actions_select on public.actions for select to authenticated
  using (case when project_id is null then app.reads_org_record(org_id) else app.reads_record(project_id) end);
create policy actions_insert on public.actions for insert to authenticated
  with check (raised_by = (select auth.uid())
              and case when project_id is null then app.can_manage_crew(org_id) else app.can_run_talks(project_id) end);
create policy actions_update on public.actions for update to authenticated
  using (done_at is null and (
    assigned_to = (select auth.uid()) or raised_by = (select auth.uid())
    or case when project_id is null then app.can_manage_crew(org_id) else app.can_manage_incidents(project_id) end))
  with check (
    assigned_to = (select auth.uid()) or raised_by = (select auth.uid())
    or case when project_id is null then app.can_manage_crew(org_id) else app.can_manage_incidents(project_id) end);
create policy actions_delete_own_open on public.actions for delete to authenticated
  using (raised_by = (select auth.uid()) and done_at is null);
grant select, insert, update, delete on public.actions to authenticated;
-- The record lock every record table carries (migration 20260915140000): a labourer reads none of it by API either.
create policy actions_reads_record on public.actions as restrictive for select to authenticated
  using (case when project_id is null then app.reads_org_record(org_id) else app.reads_record(project_id) end);

-- Marking done: the ASSIGNEE of an action of any origin may mark it done, where its table's policy would not
-- otherwise let them — an action given to a leading hand on an inspection they did not sign is theirs to close.
-- Only the done columns and nothing else; each table's trigger still stamps the clock and freezes the row.
create policy incident_actions_update_assignee on public.incident_actions for update to authenticated
  using (assigned_to = (select auth.uid()) and done_at is null) with check (assigned_to = (select auth.uid()));
create policy inspection_actions_update_assignee on public.inspection_actions for update to authenticated
  using (assigned_to = (select auth.uid()) and done_at is null) with check (assigned_to = (select auth.uid()));
create policy audit_findings_update_assignee on public.audit_findings for update to authenticated
  using (assigned_to = (select auth.uid()) and done_at is null) with check (assigned_to = (select auth.uid()));
create policy review_actions_update_assignee on public.review_actions for update to authenticated
  using (assigned_to = (select auth.uid()) and done_at is null) with check (assigned_to = (select auth.uid()));
create policy compliance_results_update_assignee on public.compliance_evaluation_results for update to authenticated
  using (assigned_to = (select auth.uid()) and done_at is null) with check (assigned_to = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 3. The register: six sources, one shape. security_invoker, so each table's RLS applies to the caller.
-- Only actions that stand: an audit's findings once issued (and only findings with an action), a review's actions
-- once issued, an evaluation's non-compliant results once issued; incident and inspection actions always;
-- manual actions always.
-- ---------------------------------------------------------------------------
create or replace view public.action_register
with (security_invoker = true) as
  select 'manual'::text as origin, a.id, a.org_id, a.project_id,
         null::uuid as record_id, null::text as record_ref, null::text as record_title,
         a.action, a.detail, a.priority, a.owner_name, a.assigned_to, a.due_on,
         a.done_at, a.done_by, a.done_note, a.raised_by, a.created_at as raised_at
    from public.actions a
  union all
  select 'incident', x.id, p.org_id, i.project_id,
         i.id, 'INC-' || lpad(i.seq::text, 3, '0'), left(i.description, 80),
         x.action, null, x.priority, x.owner_name, x.assigned_to, x.due_on,
         x.done_at, x.done_by, x.done_note, x.created_by, x.created_at
    from public.incident_actions x
    join public.incidents i on i.id = x.incident_id
    join public.projects p on p.id = i.project_id
  union all
  select 'inspection', x.id, p.org_id, i.project_id,
         i.id, i.template_name || ' ' || to_char(i.inspection_date, 'DD/MM/YYYY'), null,
         x.action, null, x.priority, x.owner_name, x.assigned_to, x.due_on,
         x.done_at, x.done_by, x.done_note, x.created_by, x.created_at
    from public.inspection_actions x
    join public.inspections i on i.id = x.inspection_id
    join public.projects p on p.id = i.project_id
  union all
  select 'audit', f.id, a.org_id, a.project_id,
         a.id, 'Audit ' || to_char(a.audit_date, 'DD/MM/YYYY'), left(f.finding, 80),
         f.action, null, f.priority, f.owner_name, f.assigned_to, f.due_on,
         f.done_at, null, f.done_note, a.created_by, f.created_at
    from public.audit_findings f
    join public.audits a on a.id = f.audit_id
   where a.status = 'issued' and f.action is not null and length(btrim(f.action)) > 0
  union all
  select 'review', r.id, m.org_id, m.project_id,
         m.id, 'Management review ' || to_char(m.held_on, 'DD/MM/YYYY'), null,
         r.action, null, r.priority, r.owner_name, r.assigned_to, r.due_on,
         r.done_at, null, r.done_note, m.created_by, r.created_at
    from public.review_actions r
    join public.management_reviews m on m.id = r.review_id
   where m.status = 'issued'
  union all
  select 'compliance', c.id, e.org_id, e.project_id,
         e.id, 'Compliance evaluation ' || to_char(e.evaluated_on, 'DD/MM/YYYY'), left(o.title, 80),
         c.action, null, c.priority, c.owner_name, c.assigned_to, c.due_on,
         c.done_at, null, c.done_note, e.created_by, c.created_at
    from public.compliance_evaluation_results c
    join public.compliance_evaluations e on e.id = c.evaluation_id
    join public.env_legal_obligations o on o.id = c.legal_obligation_id
   where e.status = 'issued' and c.result = 'non_compliant' and c.action is not null;
grant select on public.action_register to authenticated;

-- One call for the screen, whatever the origin. Security INVOKER: the caller's own RLS and each table's
-- trigger decide; this only knows which table. A missing row is "not on the file" either way — a row the
-- caller may not read and a row that does not exist are the same answer, on purpose.
create or replace function public.update_action(
  p_origin text, p_id uuid, p_assigned_to uuid, p_priority text, p_due_on date, p_owner_name text)
returns void language plpgsql security invoker set search_path = '' as $$
declare n integer;
begin
  if p_priority not in ('normal', 'high', 'critical') then
    raise exception 'Priority is normal, high or critical.' using errcode = 'check_violation';
  end if;
  if p_origin = 'manual' then
    update public.actions set assigned_to = p_assigned_to, priority = p_priority, due_on = p_due_on, owner_name = p_owner_name where id = p_id;
  elsif p_origin = 'incident' then
    update public.incident_actions set assigned_to = p_assigned_to, priority = p_priority, due_on = p_due_on, owner_name = p_owner_name where id = p_id;
  elsif p_origin = 'inspection' then
    update public.inspection_actions set assigned_to = p_assigned_to, priority = p_priority, due_on = p_due_on, owner_name = p_owner_name where id = p_id;
  -- An issued audit's finding, review's action or evaluation's result keeps its wording, owner and due date
  -- (their own triggers say so); only who it is given to and at what priority move.
  elsif p_origin = 'audit' then
    update public.audit_findings set assigned_to = p_assigned_to, priority = p_priority where id = p_id;
  elsif p_origin = 'review' then
    update public.review_actions set assigned_to = p_assigned_to, priority = p_priority where id = p_id;
  elsif p_origin = 'compliance' then
    update public.compliance_evaluation_results set assigned_to = p_assigned_to, priority = p_priority where id = p_id;
  else
    raise exception 'Unknown origin.' using errcode = 'check_violation';
  end if;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'That action is not on the file, or not yours to change.' using errcode = 'no_data_found'; end if;
end; $$;

create or replace function public.complete_action(p_origin text, p_id uuid, p_note text)
returns void language plpgsql security invoker set search_path = '' as $$
declare n integer;
begin
  if p_origin = 'manual' then
    update public.actions set done_at = now(), done_note = p_note where id = p_id;
  elsif p_origin = 'incident' then
    update public.incident_actions set done_at = now(), done_note = p_note where id = p_id;
  elsif p_origin = 'inspection' then
    update public.inspection_actions set done_at = now(), done_note = p_note where id = p_id;
  elsif p_origin = 'audit' then
    update public.audit_findings set done_at = now(), done_note = p_note where id = p_id;
  elsif p_origin = 'review' then
    update public.review_actions set done_at = now(), done_note = p_note where id = p_id;
  elsif p_origin = 'compliance' then
    update public.compliance_evaluation_results set done_at = now(), done_note = p_note where id = p_id;
  else
    raise exception 'Unknown origin.' using errcode = 'check_violation';
  end if;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'That action is not on the file, or not yours to close.' using errcode = 'no_data_found'; end if;
end; $$;
grant execute on function public.update_action(text, uuid, uuid, text, date, text) to authenticated;
grant execute on function public.complete_action(text, uuid, text) to authenticated;
