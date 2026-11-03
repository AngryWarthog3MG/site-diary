-- Risk register (README R187; item 6 of the Stems migration).
--
-- A risk PROFILE is an assessment with a scope — the company, a job, or an asset — an originator, an assessor and an
-- owner, drafted then current then archived, reviewed on a cycle whose next due is never stored. A RISK on it is a
-- task, a step, a hazard and the unwanted event, rated inherent (before controls), residual (with the existing
-- controls) and potential (with the planned ones too) against the company's matrix — the 5×5 the SWMS uses unless the
-- office sets its own; the level is stamped by the database from the likelihood and consequence at the time, so a
-- later change to the matrix never rewrites a rating already made. A CONTROL on a risk sits on the hierarchy, existing
-- or planned, critical or not; a planned control is an ACTION in the action register (origin `risk`) and moving it
-- into place is how that action is done. Nothing here is deleted; a risk closes with a reason and freezes.
--
-- The labourer reads none of it. Assessing = app.can_write_swms on the job for a job's profile, the office for the
-- company's and an asset's.

-- ---------------------------------------------------------------------------
-- 1. The company's matrix. Rows are likelihood (rare … almost certain), columns consequence (insignificant …
--    catastrophic), each cell a level. The built-in is the SWMS's; the office may set its own.
-- ---------------------------------------------------------------------------
create or replace function app.risk_matrix_default()
returns jsonb language sql immutable as $$
  select '[["low","low","medium","medium","high"],
          ["low","low","medium","high","high"],
          ["low","medium","high","high","extreme"],
          ["medium","medium","high","extreme","extreme"],
          ["medium","high","extreme","extreme","extreme"]]'::jsonb;
$$;

create table public.org_risk_matrices (
  org_id      uuid primary key references public.organisations (id) on delete restrict,
  cells       jsonb not null default app.risk_matrix_default(),
  note        text,
  updated_by  uuid references auth.users (id),
  updated_at  timestamptz not null default now()
);

create or replace function app.org_risk_matrices_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare r jsonb; c jsonb;
begin
  if jsonb_typeof(new.cells) <> 'array' or jsonb_array_length(new.cells) <> 5 then
    raise exception 'The matrix is five rows of likelihood.' using errcode = 'check_violation';
  end if;
  for r in select * from jsonb_array_elements(new.cells) loop
    if jsonb_typeof(r) <> 'array' or jsonb_array_length(r) <> 5 then
      raise exception 'Each row of the matrix has five consequences.' using errcode = 'check_violation';
    end if;
    for c in select * from jsonb_array_elements(r) loop
      if jsonb_typeof(c) <> 'string' or (c #>> '{}') not in ('low', 'medium', 'high', 'extreme') then
        raise exception 'A cell of the matrix is low, medium, high or extreme.' using errcode = 'check_violation';
      end if;
    end loop;
  end loop;
  new.note := nullif(btrim(coalesce(new.note, '')), '');
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  new.updated_at := now();
  return new;
end; $$;
create trigger a_org_risk_matrices_before_write before insert or update on public.org_risk_matrices
  for each row execute function app.org_risk_matrices_before_write();

-- The level a likelihood and consequence rate at, on this company's matrix. The TS twin is `riskLevelOn` in
-- src/lib/risks/model.ts — change both together.
create or replace function app.risk_level(p_org uuid, p_likelihood text, p_consequence text)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce((select m.cells from public.org_risk_matrices m where m.org_id = p_org), app.risk_matrix_default())
         -> (array_position(array['rare','unlikely','possible','likely','almost_certain'], p_likelihood) - 1)
         ->> (array_position(array['insignificant','minor','moderate','major','catastrophic'], p_consequence) - 1);
$$;

-- ---------------------------------------------------------------------------
-- 2. Profiles.
-- ---------------------------------------------------------------------------
create table public.risk_profiles (
  id                      uuid primary key default gen_random_uuid(),
  org_id                  uuid not null references public.organisations (id) on delete restrict,
  scope                   text not null check (scope in ('company', 'project', 'asset')),
  project_id              uuid references public.projects (id) on delete restrict,
  asset_id                uuid references public.assets (id) on delete restrict,
  name                    text not null check (length(btrim(name)) > 0),
  description             text,
  originator_name         text,
  assessor_name           text,
  owner_name              text,
  status                  text not null default 'draft' check (status in ('draft', 'current', 'archived')),
  review_interval_months  integer not null default 12 check (review_interval_months between 1 and 60),
  made_current_at         timestamptz,
  archived_at             timestamptz,
  archived_by             uuid references auth.users (id),
  archived_reason         text,
  created_by              uuid references auth.users (id),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint risk_profiles_scope_whole check (
    (scope = 'company' and project_id is null and asset_id is null)
    or (scope = 'project' and project_id is not null and asset_id is null)
    or (scope = 'asset' and asset_id is not null and project_id is null))
);
create index risk_profiles_org_idx on public.risk_profiles (org_id, status, scope);
create index risk_profiles_project_idx on public.risk_profiles (project_id) where project_id is not null;
create index risk_profiles_asset_idx on public.risk_profiles (asset_id) where asset_id is not null;

comment on table public.risk_profiles is 'README R187. A risk assessment with a scope: the company, a job or an asset. Draft → current → archived; reviewed on a cycle whose next due is derived, never stored.';

-- Who assesses: a job's profile is the job's (app.can_write_swms: supervisor, admin, PM there); the company's and an
-- asset's are the office's.
create or replace function app.can_assess_risk(p_org uuid, p_project uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select case when p_project is not null then app.can_write_swms(p_project) else app.is_org_office(p_org) end;
$$;
create or replace function app.risk_profile_writable(p_profile uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.can_assess_risk(p.org_id, p.project_id) from public.risk_profiles p where p.id = p_profile;
$$;
create or replace function app.risk_profile_org(p_profile uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select org_id from public.risk_profiles where id = p_profile;
$$;

create or replace function app.risk_profiles_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare porg uuid;
begin
  new.updated_at := now();
  new.name := btrim(new.name);
  new.description := nullif(btrim(coalesce(new.description, '')), '');
  new.originator_name := nullif(btrim(coalesce(new.originator_name, '')), '');
  new.assessor_name := nullif(btrim(coalesce(new.assessor_name, '')), '');
  new.owner_name := nullif(btrim(coalesce(new.owner_name, '')), '');
  new.archived_reason := nullif(btrim(coalesce(new.archived_reason, '')), '');
  if new.project_id is not null then
    select org_id into porg from public.projects where id = new.project_id;
    if porg is distinct from new.org_id then raise exception 'That job is another company''s.' using errcode = 'check_violation'; end if;
  end if;
  if new.asset_id is not null then
    select org_id into porg from public.assets where id = new.asset_id;
    if porg is distinct from new.org_id then raise exception 'That asset is another company''s.' using errcode = 'check_violation'; end if;
  end if;
  if tg_op = 'INSERT' then
    new.status := 'draft'; new.made_current_at := null; new.archived_at := null; new.archived_by := null; new.archived_reason := null;
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.created_at := now();
    return new;
  end if;
  if new.org_id <> old.org_id or new.scope <> old.scope or new.project_id is distinct from old.project_id or new.asset_id is distinct from old.asset_id or new.created_at <> old.created_at then
    raise exception 'A profile keeps its company and its scope.' using errcode = 'check_violation';
  end if;
  if old.status = 'archived' then
    raise exception 'An archived profile is frozen.' using errcode = 'check_violation';
  end if;
  if new.status <> old.status then
    if old.status = 'draft' and new.status = 'current' then
      new.made_current_at := now();
    elsif new.status = 'archived' then
      if new.archived_reason is null then raise exception 'Say why the profile is archived.' using errcode = 'check_violation'; end if;
      new.archived_at := now(); new.archived_by := coalesce(auth.uid(), new.archived_by);
    else
      raise exception 'A profile goes draft, then current, then archived — never back.' using errcode = 'check_violation';
    end if;
  else
    new.made_current_at := old.made_current_at; new.archived_at := old.archived_at; new.archived_by := old.archived_by; new.archived_reason := old.archived_reason;
  end if;
  return new;
end; $$;
create trigger a_risk_profiles_before_write before insert or update on public.risk_profiles
  for each row execute function app.risk_profiles_before_write();

create or replace function app.risk_profiles_before_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'A profile is archived, never deleted — its risks and their actions point at it.' using errcode = 'check_violation';
end; $$;
create trigger a_risk_profiles_before_delete before delete on public.risk_profiles
  for each row execute function app.risk_profiles_before_delete();

-- Reviews: one row each time the profile is looked over; frozen. The next review counts from the last one.
create table public.risk_profile_reviews (
  id                uuid primary key default gen_random_uuid(),
  profile_id        uuid not null references public.risk_profiles (id) on delete restrict,
  reviewed_on       date not null,
  reviewed_by_name  text not null check (length(btrim(reviewed_by_name)) > 0),
  note              text,
  created_by        uuid references auth.users (id),
  created_at        timestamptz not null default now()
);
create index risk_profile_reviews_idx on public.risk_profile_reviews (profile_id, reviewed_on desc);

create or replace function app.risk_profile_reviews_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.risk_profiles p where p.id = new.profile_id and p.status = 'archived') then
    raise exception 'An archived profile is not reviewed; make a new one.' using errcode = 'check_violation';
  end if;
  if new.reviewed_on > (now() at time zone 'Australia/Perth')::date then
    raise exception 'A review cannot be in the future.' using errcode = 'check_violation';
  end if;
  new.reviewed_by_name := btrim(new.reviewed_by_name);
  new.note := nullif(btrim(coalesce(new.note, '')), '');
  new.created_by := coalesce(auth.uid(), new.created_by);
  new.created_at := now();
  return new;
end; $$;
create trigger a_risk_profile_reviews_before_insert before insert on public.risk_profile_reviews
  for each row execute function app.risk_profile_reviews_before_insert();
create trigger a_risk_profile_reviews_no_update before update on public.risk_profile_reviews
  for each row execute function app.frozen_row();
create trigger a_risk_profile_reviews_no_delete before delete on public.risk_profile_reviews
  for each row execute function app.frozen_row();

-- When the profile is next due a review: the last review, else the day it was made, plus the interval. Null once
-- archived. The TS twin is `reviewDue` in src/lib/risks/model.ts — change both together.
create or replace function app.risk_profile_review_due(p_profile uuid)
returns date language sql stable security definer set search_path = '' as $$
  select case when p.status = 'archived' then null
         else (coalesce((select max(r.reviewed_on) from public.risk_profile_reviews r where r.profile_id = p.id),
                        (p.created_at at time zone 'Australia/Perth')::date)
               + make_interval(months => p.review_interval_months))::date end
    from public.risk_profiles p where p.id = p_profile;
$$;
grant execute on function app.risk_profile_review_due(uuid) to authenticated;
grant execute on function app.risk_level(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Risks. Numbered per company (RSK-001) under a lock. The level of each rating is the database's: computed from
--    the likelihood and consequence on the company's matrix when both are given, else taken as typed (a SWMS step
--    brings only a level). Closed with a reason, then frozen.
-- ---------------------------------------------------------------------------
create table public.risks (
  id                     uuid primary key default gen_random_uuid(),
  org_id                 uuid not null references public.organisations (id) on delete restrict,
  profile_id             uuid not null references public.risk_profiles (id) on delete restrict,
  seq                    integer not null,
  task                   text not null check (length(btrim(task)) > 0),
  step                   text,
  hazard                 text not null check (length(btrim(hazard)) > 0),
  hazard_type            text,
  unwanted_event         text,
  inherent_likelihood    text check (inherent_likelihood is null or inherent_likelihood in ('rare', 'unlikely', 'possible', 'likely', 'almost_certain')),
  inherent_consequence   text check (inherent_consequence is null or inherent_consequence in ('insignificant', 'minor', 'moderate', 'major', 'catastrophic')),
  inherent_level         text not null check (inherent_level in ('low', 'medium', 'high', 'extreme')),
  residual_likelihood    text check (residual_likelihood is null or residual_likelihood in ('rare', 'unlikely', 'possible', 'likely', 'almost_certain')),
  residual_consequence   text check (residual_consequence is null or residual_consequence in ('insignificant', 'minor', 'moderate', 'major', 'catastrophic')),
  residual_level         text check (residual_level is null or residual_level in ('low', 'medium', 'high', 'extreme')),
  potential_likelihood   text check (potential_likelihood is null or potential_likelihood in ('rare', 'unlikely', 'possible', 'likely', 'almost_certain')),
  potential_consequence  text check (potential_consequence is null or potential_consequence in ('insignificant', 'minor', 'moderate', 'major', 'catastrophic')),
  potential_level        text check (potential_level is null or potential_level in ('low', 'medium', 'high', 'extreme')),
  critical               boolean not null default false,
  owner_name             text,
  assigned_to            uuid references auth.users (id),
  status                 text not null default 'open' check (status in ('open', 'closed')),
  closed_at              timestamptz,
  closed_by              uuid references auth.users (id),
  closed_reason          text,
  source_swms_id         uuid references public.swms (id) on delete restrict,
  source_step            integer,
  notes                  text,
  created_by             uuid references auth.users (id),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint risks_seq_once unique (org_id, seq),
  constraint risks_source_whole check ((source_swms_id is null) = (source_step is null))
);
create unique index risks_source_once on public.risks (profile_id, source_swms_id, source_step) where source_swms_id is not null;
create index risks_profile_idx on public.risks (profile_id, status, seq);
create index risks_org_idx on public.risks (org_id, status);

comment on table public.risks is 'README R187. A task, a step, a hazard and the unwanted event, rated inherent / residual / potential on the company''s matrix; the level is stamped by the database when the likelihood and consequence are given.';

create or replace function app.risks_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare p record; lvl text;
begin
  new.updated_at := now();
  new.task := btrim(new.task);
  new.step := nullif(btrim(coalesce(new.step, '')), '');
  new.hazard := btrim(new.hazard);
  new.hazard_type := nullif(btrim(coalesce(new.hazard_type, '')), '');
  new.unwanted_event := nullif(btrim(coalesce(new.unwanted_event, '')), '');
  new.owner_name := nullif(btrim(coalesce(new.owner_name, '')), '');
  new.closed_reason := nullif(btrim(coalesce(new.closed_reason, '')), '');
  new.notes := nullif(btrim(coalesce(new.notes, '')), '');
  select org_id, project_id, status into p from public.risk_profiles where id = new.profile_id;
  if p.org_id is null or p.org_id <> new.org_id then
    raise exception 'That profile is another company''s.' using errcode = 'check_violation';
  end if;
  if not app.action_assignee_ok(new.org_id, p.project_id, new.assigned_to) then
    raise exception 'A risk is assigned to someone on the job.' using errcode = 'check_violation';
  end if;
  if new.source_swms_id is not null and not exists (select 1 from public.swms s where s.id = new.source_swms_id and (p.project_id is null or s.project_id = p.project_id)) then
    raise exception 'That SWMS is not this job''s.' using errcode = 'check_violation';
  end if;
  -- The level is the matrix's wherever the likelihood and consequence are both given.
  if new.inherent_likelihood is not null and new.inherent_consequence is not null then
    new.inherent_level := app.risk_level(new.org_id, new.inherent_likelihood, new.inherent_consequence);
  end if;
  if new.residual_likelihood is not null and new.residual_consequence is not null then
    new.residual_level := app.risk_level(new.org_id, new.residual_likelihood, new.residual_consequence);
  elsif new.residual_likelihood is not null or new.residual_consequence is not null then
    raise exception 'A residual rating needs both its likelihood and its consequence.' using errcode = 'check_violation';
  end if;
  if new.potential_likelihood is not null and new.potential_consequence is not null then
    new.potential_level := app.risk_level(new.org_id, new.potential_likelihood, new.potential_consequence);
  elsif new.potential_likelihood is not null or new.potential_consequence is not null then
    raise exception 'A potential rating needs both its likelihood and its consequence.' using errcode = 'check_violation';
  end if;
  if (new.inherent_likelihood is null) <> (new.inherent_consequence is null) then
    raise exception 'An inherent rating needs both its likelihood and its consequence, or a level alone.' using errcode = 'check_violation';
  end if;
  if tg_op = 'INSERT' then
    if p.status = 'archived' then raise exception 'An archived profile takes no new risk.' using errcode = 'check_violation'; end if;
    perform pg_advisory_xact_lock(hashtext('risks:' || new.org_id::text));
    select coalesce(max(seq), 0) + 1 into new.seq from public.risks where org_id = new.org_id;
    new.status := 'open'; new.closed_at := null; new.closed_by := null; new.closed_reason := null;
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.created_at := now();
    return new;
  end if;
  if new.org_id <> old.org_id or new.profile_id <> old.profile_id or new.seq <> old.seq or new.created_at <> old.created_at
     or new.source_swms_id is distinct from old.source_swms_id or new.source_step is distinct from old.source_step then
    raise exception 'A risk keeps its number, its profile and where it came from.' using errcode = 'check_violation';
  end if;
  if old.status = 'closed' then
    raise exception 'A closed risk is frozen.' using errcode = 'check_violation';
  end if;
  if new.status = 'closed' then
    if new.closed_reason is null then raise exception 'Say why the risk is closed.' using errcode = 'check_violation'; end if;
    new.closed_at := now(); new.closed_by := coalesce(auth.uid(), new.closed_by);
  else
    new.closed_at := null; new.closed_by := null; new.closed_reason := null;
  end if;
  return new;
end; $$;
create trigger a_risks_before_write before insert or update on public.risks
  for each row execute function app.risks_before_write();
create or replace function app.risks_before_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'A risk is closed, never deleted.' using errcode = 'check_violation';
end; $$;
create trigger a_risks_before_delete before delete on public.risks
  for each row execute function app.risks_before_delete();

-- ---------------------------------------------------------------------------
-- 4. Controls. Existing (in place from the day it is written down) or planned (an action: due, assigned, at a
--    priority — done by moving it into place). Critical controls are marked. Withdrawn only with a reason, then frozen.
-- ---------------------------------------------------------------------------
create table public.risk_controls (
  id                uuid primary key default gen_random_uuid(),
  risk_id           uuid not null references public.risks (id) on delete restrict,
  description       text not null check (length(btrim(description)) > 0),
  -- Where it sits on the hierarchy; null until classed (a SWMS brings its controls as words).
  level             text check (level is null or level in ('elimination', 'substitution', 'isolation', 'engineering', 'administrative', 'ppe')),
  kind              text not null check (kind in ('existing', 'planned')),
  critical          boolean not null default false,
  status            text not null check (status in ('planned', 'in_place', 'withdrawn')),
  -- The action a planned control is (R177).
  due_on            date,
  priority          text not null default 'normal' check (priority in ('normal', 'high', 'critical')),
  owner_name        text,
  assigned_to       uuid references auth.users (id),
  assigned_at       timestamptz,
  in_place_at       timestamptz,
  in_place_by       uuid references auth.users (id),
  in_place_note     text,
  withdrawn_at      timestamptz,
  withdrawn_by      uuid references auth.users (id),
  withdrawn_reason  text,
  created_by        uuid references auth.users (id),
  created_at        timestamptz not null default now()
);
create index risk_controls_idx on public.risk_controls (risk_id, status);
create index risk_controls_assigned_idx on public.risk_controls (assigned_to) where status = 'planned';

create or replace function app.risk_control_org(p_risk uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select org_id from public.risks where id = p_risk;
$$;
create or replace function app.risk_writable(p_risk uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.risk_profile_writable(r.profile_id) from public.risks r where r.id = p_risk;
$$;

create or replace function app.risk_controls_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  new.description := btrim(new.description);
  new.owner_name := nullif(btrim(coalesce(new.owner_name, '')), '');
  new.in_place_note := nullif(btrim(coalesce(new.in_place_note, '')), '');
  new.withdrawn_reason := nullif(btrim(coalesce(new.withdrawn_reason, '')), '');
  select x.org_id, x.status, p.project_id into r from public.risks x join public.risk_profiles p on p.id = x.profile_id where x.id = new.risk_id;
  if r.org_id is null then raise exception 'That risk is not on the register.' using errcode = 'check_violation'; end if;
  if not app.action_assignee_ok(r.org_id, r.project_id, new.assigned_to) then
    raise exception 'A control is assigned to someone on the job.' using errcode = 'check_violation';
  end if;
  if tg_op = 'INSERT' then
    if r.status = 'closed' then raise exception 'A closed risk takes no new control.' using errcode = 'check_violation'; end if;
    new.status := case when new.kind = 'existing' then 'in_place' else 'planned' end;
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.created_at := now();
    new.assigned_at := case when new.assigned_to is null then null else now() end;
    if new.status = 'in_place' then new.in_place_at := now(); new.in_place_by := coalesce(auth.uid(), new.in_place_by); else new.in_place_at := null; new.in_place_by := null; end if;
    new.in_place_note := null; new.withdrawn_at := null; new.withdrawn_by := null; new.withdrawn_reason := null;
    return new;
  end if;
  if new.risk_id <> old.risk_id or new.kind <> old.kind or new.created_at <> old.created_at or new.created_by is distinct from old.created_by then
    raise exception 'A control keeps its risk and what it was when assessed.' using errcode = 'check_violation';
  end if;
  if old.status = 'withdrawn' then raise exception 'A withdrawn control is frozen.' using errcode = 'check_violation'; end if;
  if new.assigned_to is distinct from old.assigned_to then
    new.assigned_at := case when new.assigned_to is null then null else now() end;
  else
    new.assigned_at := old.assigned_at;
  end if;
  if new.status = 'withdrawn' then
    if new.withdrawn_reason is null then raise exception 'Say why the control was withdrawn.' using errcode = 'check_violation'; end if;
    new.withdrawn_at := now(); new.withdrawn_by := coalesce(auth.uid(), new.withdrawn_by);
  else
    new.withdrawn_at := null; new.withdrawn_by := null; new.withdrawn_reason := null;
  end if;
  if new.status = 'in_place' and old.status <> 'in_place' then
    new.in_place_at := now(); new.in_place_by := coalesce(auth.uid(), new.in_place_by);
  elsif new.status = 'in_place' then
    new.in_place_at := old.in_place_at; new.in_place_by := old.in_place_by;
    if old.in_place_note is not null then new.in_place_note := old.in_place_note; end if;
  elsif new.status = 'planned' and old.status = 'in_place' then
    raise exception 'A control in place stays in place; withdraw it with a reason instead.' using errcode = 'check_violation';
  end if;
  return new;
end; $$;
create trigger a_risk_controls_before_write before insert or update on public.risk_controls
  for each row execute function app.risk_controls_before_write();
create trigger a_risk_controls_no_delete before delete on public.risk_controls
  for each row execute function app.frozen_row();

-- ---------------------------------------------------------------------------
-- 5. The action register gains origin `risk` (R177): a planned control, open until it is in place. Its wording is
--    the control's; who holds it, its priority and its due day may move; closing it through the register moves it
--    into place. The dispatchers recreated whole.
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
   where e.status = 'issued' and c.result = 'non_compliant' and c.action is not null
  union all
  select 'form', n.id, p.org_id, n.project_id,
         s.id, s.template_code || ' ' || to_char(s.completed_at at time zone 'Australia/Perth', 'DD/MM/YYYY'), left(s.template_title, 80),
         n.action, n.note, n.priority, n.owner_name, n.assigned_to, n.due_on,
         n.done_at, n.done_by, n.done_note, s.completed_by, n.created_at
    from public.form_non_compliances n
    join public.form_submissions s on s.id = n.submission_id
    join public.projects p on p.id = n.project_id
   where n.raised_as_action and n.status <> 'removed' and s.status = 'completed'
  union all
  select 'asset', x.id, x.org_id, null::uuid,
         x.asset_id, coalesce(pl.name, a.name) || case when coalesce(pl.plant_no, a.asset_no) is not null then ' · ' || coalesce(pl.plant_no, a.asset_no) else '' end, left(pr.label, 80),
         x.action, x.detail, x.priority, x.owner_name, x.assigned_to, x.due_on,
         x.done_at, x.done_by, x.done_note, pr.created_by, x.created_at
    from public.asset_actions x
    join public.assets a on a.id = x.asset_id
    left join public.plant_register pl on pl.id = a.plant_id
    join public.asset_profiles pr on pr.id = x.profile_id
  union all
  select 'risk', c.id, r.org_id, p.project_id,
         p.id, 'RSK-' || lpad(r.seq::text, 3, '0'), left(r.hazard, 80),
         c.description, case when c.critical then 'Critical control' else null end, c.priority, c.owner_name, c.assigned_to, c.due_on,
         c.in_place_at, c.in_place_by, c.in_place_note, c.created_by, c.created_at
    from public.risk_controls c
    join public.risks r on r.id = c.risk_id
    join public.risk_profiles p on p.id = r.profile_id
   where c.kind = 'planned' and c.status in ('planned', 'in_place');

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
  elsif p_origin = 'form' then
    update public.form_non_compliances set assigned_to = p_assigned_to, priority = p_priority, due_on = p_due_on, owner_name = p_owner_name where id = p_id;
  elsif p_origin = 'asset' then
    update public.asset_actions set assigned_to = p_assigned_to, priority = p_priority, owner_name = p_owner_name where id = p_id;
  elsif p_origin = 'risk' then
    update public.risk_controls set assigned_to = p_assigned_to, priority = p_priority, due_on = p_due_on, owner_name = p_owner_name where id = p_id and kind = 'planned';
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
  elsif p_origin = 'form' then
    update public.form_non_compliances set done_at = now(), done_note = p_note where id = p_id;
  elsif p_origin = 'asset' then
    update public.asset_actions set done_at = now(), done_note = p_note where id = p_id;
  elsif p_origin = 'risk' then
    update public.risk_controls set status = 'in_place', in_place_note = p_note where id = p_id and kind = 'planned' and status = 'planned';
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

-- ---------------------------------------------------------------------------
-- 6. Access. The matrix is every member's to read and the office's to set. The register is the company's record:
--    members read it behind the restrictive record lock (the labourer reads none); a job's profile is written by
--    app.can_write_swms on that job, the company's and an asset's by the office; a planned control's assignee may
--    move it (the point of assigning it).
-- ---------------------------------------------------------------------------
alter table public.org_risk_matrices enable row level security;
alter table public.risk_profiles enable row level security;
alter table public.risk_profile_reviews enable row level security;
alter table public.risks enable row level security;
alter table public.risk_controls enable row level security;

create policy org_risk_matrices_select on public.org_risk_matrices for select to authenticated using (app.is_org_member(org_id));
create policy org_risk_matrices_insert on public.org_risk_matrices for insert to authenticated with check (app.is_org_office(org_id));
create policy org_risk_matrices_update on public.org_risk_matrices for update to authenticated using (app.is_org_office(org_id)) with check (app.is_org_office(org_id));

create policy risk_profiles_select on public.risk_profiles for select to authenticated using (app.is_org_member(org_id));
create policy risk_profiles_reads_record on public.risk_profiles as restrictive for select to authenticated using (app.reads_org_record(org_id));
create policy risk_profiles_insert on public.risk_profiles for insert to authenticated with check (app.can_assess_risk(org_id, project_id));
create policy risk_profiles_update on public.risk_profiles for update to authenticated using (app.can_assess_risk(org_id, project_id)) with check (app.can_assess_risk(org_id, project_id));

create policy risk_profile_reviews_select on public.risk_profile_reviews for select to authenticated using (app.is_org_member(app.risk_profile_org(profile_id)));
create policy risk_profile_reviews_reads_record on public.risk_profile_reviews as restrictive for select to authenticated using (app.reads_org_record(app.risk_profile_org(profile_id)));
create policy risk_profile_reviews_insert on public.risk_profile_reviews for insert to authenticated with check (app.risk_profile_writable(profile_id));

create policy risks_select on public.risks for select to authenticated using (app.is_org_member(org_id));
create policy risks_reads_record on public.risks as restrictive for select to authenticated using (app.reads_org_record(org_id));
create policy risks_insert on public.risks for insert to authenticated with check (app.risk_profile_writable(profile_id));
create policy risks_update on public.risks for update to authenticated using (app.risk_profile_writable(profile_id)) with check (app.risk_profile_writable(profile_id));

create policy risk_controls_select on public.risk_controls for select to authenticated using (app.is_org_member(app.risk_control_org(risk_id)));
create policy risk_controls_reads_record on public.risk_controls as restrictive for select to authenticated using (app.reads_org_record(app.risk_control_org(risk_id)));
create policy risk_controls_insert on public.risk_controls for insert to authenticated with check (app.risk_writable(risk_id));
create policy risk_controls_update on public.risk_controls for update to authenticated
  using (app.risk_writable(risk_id) or (status = 'planned' and assigned_to = (select auth.uid())))
  with check (app.risk_writable(risk_id) or assigned_to = (select auth.uid()));

grant select, insert, update on public.org_risk_matrices, public.risk_profiles, public.risks, public.risk_controls to authenticated;
grant select, insert on public.risk_profile_reviews to authenticated;
grant all on public.org_risk_matrices, public.risk_profiles, public.risk_profile_reviews, public.risks, public.risk_controls to service_role;
