-- ============================================================================
-- Internal audits and management reviews: the reports, their findings and
-- actions, and the link that discharges their schedule.
--
-- ISO 9001, 45001 and 14001 cl. 9.2 require an audit programme, audits against
-- defined criteria and scope, auditors chosen "to ensure objectivity and the
-- impartiality of the audit process" (9.2.2 c), results reported, and retained
-- documented information as evidence. Cl. 9.3 requires management reviews that
-- consider set inputs — the status of actions from previous reviews first
-- (9.3.2 a) — and produce decisions and actions, again retained.
--
-- Main Roads WA Specification 201 adds, for its contracts: audits within six
-- weeks and at most three-monthly, by auditors "not delivering work under the
-- Contract", reports within one week, each audit reviewing the previous audit's
-- corrective actions, and management review actions "reviewed at subsequent
-- meetings until closed-out" (cl. 201.12.03, 201.13). The cadence is already the
-- scheduler's (README R61). This is the evidence the schedule points at.
--
-- Shape: an audit and a review are drafted, then issued, then frozen. A finding
-- and an action are records whose done-ness the database stamps, then freezes —
-- the same as incident and inspection actions. Issuing an audit or a review that
-- names its schedule records the schedule's completion in the same transaction,
-- so the two cannot disagree.
-- ============================================================================

-- When a schedule's next occurrence is due, in SQL — the same rule as nextDue in
-- src/lib/obligations/model.ts: from the last completion's done date, or the first
-- due date if none. date + interval 'n months' clamps to the end of a shorter month,
-- as addMonths does.
create or replace function app.obligation_next_due(p_obligation uuid)
returns date language sql stable security definer set search_path = ''
as $$
  select case
    when not o.active then null
    when not exists (select 1 from public.obligation_completions c where c.obligation_id = o.id) then o.first_due_on
    when o.interval_months is null then null
    else ((select max(c.done_on) from public.obligation_completions c where c.obligation_id = o.id)
          + make_interval(months => o.interval_months))::date
  end
  from public.obligations o where o.id = p_obligation
$$;
grant execute on function app.obligation_next_due(uuid) to authenticated;

create table public.audits (
  id                        uuid primary key default gen_random_uuid(),
  org_id                    uuid not null references public.organisations (id) on delete restrict,
  project_id                uuid references public.projects (id) on delete restrict,
  obligation_id             uuid references public.obligations (id) on delete restrict,
  audit_date                date not null,
  scope                     text not null check (length(btrim(scope)) > 0),
  criteria                  text not null check (length(btrim(criteria)) > 0),
  auditor_name              text not null check (length(btrim(auditor_name)) > 0),
  -- cl. 9.2.2 c: objectivity and impartiality. Spec 201: not delivering the work audited.
  auditor_independent       boolean not null default false,
  previous_actions_review   text,
  summary                   text,
  status                    text not null default 'draft' check (status in ('draft', 'issued')),
  issued_on                 date,
  issued_by                 uuid references auth.users (id),
  created_by                uuid references auth.users (id),
  created_at                timestamptz not null default now()
);
create index audits_scope_idx on public.audits (org_id, project_id, audit_date desc);

create table public.audit_findings (
  id           uuid primary key default gen_random_uuid(),
  audit_id     uuid not null references public.audits (id) on delete cascade,
  seq          integer not null,
  kind         text not null check (kind in ('major_nonconformity', 'minor_nonconformity', 'observation', 'opportunity')),
  clause       text,
  finding      text not null check (length(btrim(finding)) > 0),
  action       text,
  owner_name   text,
  due_on       date,
  done_at      timestamptz,
  done_note    text,
  created_at   timestamptz not null default now()
);
create unique index audit_findings_seq_idx on public.audit_findings (audit_id, seq);

create table public.management_reviews (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organisations (id) on delete restrict,
  project_id     uuid references public.projects (id) on delete restrict,
  obligation_id  uuid references public.obligations (id) on delete restrict,
  held_on        date not null,
  attendees      text not null check (length(btrim(attendees)) > 0),
  -- cl. 9.3.2: what was considered. cl. 9.3.3: what was decided.
  inputs         text not null check (length(btrim(inputs)) > 0),
  outputs        text not null check (length(btrim(outputs)) > 0),
  status         text not null default 'draft' check (status in ('draft', 'issued')),
  issued_on      date,
  issued_by      uuid references auth.users (id),
  created_by     uuid references auth.users (id),
  created_at     timestamptz not null default now()
);
create index management_reviews_scope_idx on public.management_reviews (org_id, project_id, held_on desc);

create table public.review_actions (
  id          uuid primary key default gen_random_uuid(),
  review_id   uuid not null references public.management_reviews (id) on delete cascade,
  action      text not null check (length(btrim(action)) > 0),
  owner_name  text,
  due_on      date,
  done_at     timestamptz,
  done_note   text,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Rules shared by audits and reviews.
-- ---------------------------------------------------------------------------
create or replace function app.check_scope_and_schedule(p_org uuid, p_project uuid, p_obligation uuid, p_kind text)
returns void language plpgsql stable security definer set search_path = '' as $$
declare o record;
begin
  if p_project is not null and not exists (select 1 from public.projects p where p.id = p_project and p.org_id = p_org) then
    raise exception 'That job is not in this organisation.' using errcode = 'check_violation';
  end if;
  if p_obligation is not null then
    select org_id, project_id, kind into o from public.obligations where id = p_obligation;
    if o is null or o.org_id <> p_org or o.project_id is distinct from p_project then
      raise exception 'That schedule is not this job''s.' using errcode = 'check_violation';
    end if;
    if o.kind <> p_kind then
      raise exception 'That schedule is not for this kind of record.' using errcode = 'check_violation';
    end if;
  end if;
end; $$;

create or replace function app.audits_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare due date;
begin
  if tg_op = 'INSERT' then
    perform app.check_scope_and_schedule(new.org_id, new.project_id, new.obligation_id, 'internal_audit');
    new.status := 'draft'; new.issued_on := null; new.issued_by := null;
    new.created_by := coalesce((select auth.uid()), new.created_by);
    new.created_at := now();
    if new.audit_date > app.perth_today() then
      raise exception 'An audit is recorded once it is done.' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if old.status = 'issued' then
    raise exception 'An issued audit report is frozen.' using errcode = 'check_violation';
  end if;
  if new.org_id is distinct from old.org_id or new.project_id is distinct from old.project_id
     or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception 'An audit stays with its job.' using errcode = 'check_violation';
  end if;
  if new.obligation_id is distinct from old.obligation_id then
    perform app.check_scope_and_schedule(new.org_id, new.project_id, new.obligation_id, 'internal_audit');
  end if;
  if new.audit_date > app.perth_today() then
    raise exception 'An audit is recorded once it is done.' using errcode = 'check_violation';
  end if;
  if new.status = 'issued' then
    if not new.auditor_independent then
      raise exception 'An audit is issued only when the auditor does not deliver the work audited (ISO cl. 9.2.2).' using errcode = 'check_violation';
    end if;
    if length(btrim(coalesce(new.summary, ''))) = 0 then
      raise exception 'An audit report needs its summary of results.' using errcode = 'check_violation';
    end if;
    new.issued_on := app.perth_today();
    new.issued_by := coalesce((select auth.uid()), new.issued_by);
    if new.obligation_id is not null then
      due := app.obligation_next_due(new.obligation_id);
      if due is not null then
        insert into public.obligation_completions (obligation_id, due_on, done_on, evidence_note, evidence_ref)
        values (new.obligation_id, due, new.audit_date,
                'Internal audit report issued. Scope: ' || new.scope || '. Auditor: ' || new.auditor_name || '.',
                'audit:' || new.id::text);
      end if;
    end if;
  end if;
  return new;
end; $$;
create trigger a_audits_before_write before insert or update on public.audits
  for each row execute function app.audits_before_write();
create trigger a_audits_no_delete before delete on public.audits
  for each row execute function app.frozen_row();

create or replace function app.management_reviews_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare due date;
begin
  if tg_op = 'INSERT' then
    perform app.check_scope_and_schedule(new.org_id, new.project_id, new.obligation_id, 'management_review');
    new.status := 'draft'; new.issued_on := null; new.issued_by := null;
    new.created_by := coalesce((select auth.uid()), new.created_by);
    new.created_at := now();
    if new.held_on > app.perth_today() then
      raise exception 'A review is recorded once it is held.' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if old.status = 'issued' then
    raise exception 'An issued management review is frozen.' using errcode = 'check_violation';
  end if;
  if new.org_id is distinct from old.org_id or new.project_id is distinct from old.project_id
     or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception 'A review stays with its job.' using errcode = 'check_violation';
  end if;
  if new.obligation_id is distinct from old.obligation_id then
    perform app.check_scope_and_schedule(new.org_id, new.project_id, new.obligation_id, 'management_review');
  end if;
  if new.held_on > app.perth_today() then
    raise exception 'A review is recorded once it is held.' using errcode = 'check_violation';
  end if;
  if new.status = 'issued' then
    new.issued_on := app.perth_today();
    new.issued_by := coalesce((select auth.uid()), new.issued_by);
    if new.obligation_id is not null then
      due := app.obligation_next_due(new.obligation_id);
      if due is not null then
        insert into public.obligation_completions (obligation_id, due_on, done_on, evidence_note, evidence_ref)
        values (new.obligation_id, due, new.held_on,
                'Management review held and recorded. Attendees: ' || new.attendees || '.',
                'review:' || new.id::text);
      end if;
    end if;
  end if;
  return new;
end; $$;
create trigger a_management_reviews_before_write before insert or update on public.management_reviews
  for each row execute function app.management_reviews_before_write();
create trigger a_management_reviews_no_delete before delete on public.management_reviews
  for each row execute function app.frozen_row();

-- Findings: written while the audit is a draft; afterwards only their action is marked done, once, by the database.
create or replace function app.audit_findings_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare st text;
begin
  select status into st from public.audits where id = coalesce(new.audit_id, old.audit_id);
  if tg_op = 'DELETE' then
    if st is null then return old; end if;
    if st <> 'draft' then raise exception 'A finding in an issued report is never removed.' using errcode = 'check_violation'; end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if st <> 'draft' then raise exception 'Findings are added while the report is a draft.' using errcode = 'check_violation'; end if;
    new.done_at := null; new.created_at := now();
    return new;
  end if;
  if st = 'draft' then
    if new.audit_id is distinct from old.audit_id then raise exception 'A finding stays in its report.' using errcode = 'check_violation'; end if;
    if new.done_at is not null and old.done_at is null then new.done_at := now(); end if;
    return new;
  end if;
  -- Issued: only marking the action done, once.
  if old.done_at is not null then raise exception 'A done action is frozen.' using errcode = 'check_violation'; end if;
  if new.seq is distinct from old.seq or new.kind is distinct from old.kind or new.clause is distinct from old.clause
     or new.finding is distinct from old.finding or new.action is distinct from old.action or new.owner_name is distinct from old.owner_name
     or new.due_on is distinct from old.due_on or new.audit_id is distinct from old.audit_id then
    raise exception 'A finding in an issued report does not change; only its action is marked done.' using errcode = 'check_violation';
  end if;
  if new.done_at is not null then new.done_at := now(); end if;
  return new;
end; $$;
create trigger a_audit_findings_before_write before insert or update or delete on public.audit_findings
  for each row execute function app.audit_findings_before_write();

create or replace function app.review_actions_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare st text;
begin
  select status into st from public.management_reviews where id = coalesce(new.review_id, old.review_id);
  if tg_op = 'DELETE' then
    if st is null then return old; end if;
    if st <> 'draft' then raise exception 'An action from an issued review is never removed.' using errcode = 'check_violation'; end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if st <> 'draft' then raise exception 'Actions are added while the review is a draft.' using errcode = 'check_violation'; end if;
    new.done_at := null; new.created_at := now();
    return new;
  end if;
  if old.done_at is not null then raise exception 'A done action is frozen.' using errcode = 'check_violation'; end if;
  if st <> 'draft' and (new.action is distinct from old.action or new.owner_name is distinct from old.owner_name
     or new.due_on is distinct from old.due_on or new.review_id is distinct from old.review_id) then
    raise exception 'An action from an issued review does not change; it is carried forward until it is done.' using errcode = 'check_violation';
  end if;
  if new.done_at is not null then new.done_at := now(); end if;
  return new;
end; $$;
create trigger a_review_actions_before_write before insert or update or delete on public.review_actions
  for each row execute function app.review_actions_before_write();

-- ---------------------------------------------------------------------------
-- Access: management information. Written by supervisors and admins for a job,
-- by crew managers for the company; read by those who read the record.
-- ---------------------------------------------------------------------------
create or replace function app.audit_scope(p_audit uuid) returns table (org_id uuid, project_id uuid)
language sql stable security definer set search_path = '' as $$ select a.org_id, a.project_id from public.audits a where a.id = p_audit $$;
create or replace function app.review_scope(p_review uuid) returns table (org_id uuid, project_id uuid)
language sql stable security definer set search_path = '' as $$ select r.org_id, r.project_id from public.management_reviews r where r.id = p_review $$;
grant execute on function app.audit_scope(uuid), app.review_scope(uuid) to authenticated;

alter table public.audits enable row level security;
alter table public.audit_findings enable row level security;
alter table public.management_reviews enable row level security;
alter table public.review_actions enable row level security;

create policy audits_select on public.audits for select to authenticated using (app.obligation_readable(org_id, project_id));
create policy audits_insert on public.audits for insert to authenticated with check (app.obligation_manageable(org_id, project_id));
create policy audits_update on public.audits for update to authenticated using (app.obligation_manageable(org_id, project_id)) with check (app.obligation_manageable(org_id, project_id));
create policy audit_findings_select on public.audit_findings for select to authenticated
  using (exists (select 1 from app.audit_scope(audit_id) s where app.obligation_readable(s.org_id, s.project_id)));
create policy audit_findings_write on public.audit_findings for all to authenticated
  using (exists (select 1 from app.audit_scope(audit_id) s where app.obligation_manageable(s.org_id, s.project_id)))
  with check (exists (select 1 from app.audit_scope(audit_id) s where app.obligation_manageable(s.org_id, s.project_id)));

create policy management_reviews_select on public.management_reviews for select to authenticated using (app.obligation_readable(org_id, project_id));
create policy management_reviews_insert on public.management_reviews for insert to authenticated with check (app.obligation_manageable(org_id, project_id));
create policy management_reviews_update on public.management_reviews for update to authenticated using (app.obligation_manageable(org_id, project_id)) with check (app.obligation_manageable(org_id, project_id));
create policy review_actions_select on public.review_actions for select to authenticated
  using (exists (select 1 from app.review_scope(review_id) s where app.obligation_readable(s.org_id, s.project_id)));
create policy review_actions_write on public.review_actions for all to authenticated
  using (exists (select 1 from app.review_scope(review_id) s where app.obligation_manageable(s.org_id, s.project_id)))
  with check (exists (select 1 from app.review_scope(review_id) s where app.obligation_manageable(s.org_id, s.project_id)));

grant select, insert, update on public.audits, public.management_reviews to authenticated;
grant select, insert, update, delete on public.audit_findings, public.review_actions to authenticated;
grant all on public.audits, public.audit_findings, public.management_reviews, public.review_actions to service_role;
