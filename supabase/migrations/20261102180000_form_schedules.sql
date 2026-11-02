-- Forms engine, second ship (README R181): schedules with a next-due counted from the last completion, the
-- submission's link to the schedule it discharged, and the VOC's one-tap ticket — a crew_tickets row that names
-- the passed form, never written by the form itself.
--
-- A schedule names a FORM CODE, not a revision: when the office issues revision B, the schedule fills B from then on.
-- The next due is counted from when the last one was DONE, as obligations are (R61): a weekly inspection done late
-- does not buy the next one a week's grace. The reminder stamp is the server's.

-- ---------------------------------------------------------------------------
-- 1. Schedules.
-- ---------------------------------------------------------------------------
create table public.form_schedules (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organisations (id) on delete restrict,
  -- null = every job of the company (the office sets it; it shows on each job's calendar and What's due).
  project_id        uuid references public.projects (id) on delete restrict,
  template_code     text not null,
  -- Who is expected to fill it; null = whoever runs the site. Told by push when it is due.
  assigned_to       uuid references auth.users (id),
  -- What the form is about, when the form is about a machine or a person — one schedule per excavator.
  subject_plant_id  uuid references public.plant_register (id),
  subject_person    text,
  every             integer not null check (every between 1 and 365),
  unit              text not null check (unit in ('day', 'week', 'month')),
  first_due_on      date not null,
  active            boolean not null default true,
  notes             text,
  -- The server's: the night the assignee was last told. Never the phone's.
  last_reminded_on  date,
  created_by        uuid references auth.users (id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index form_schedules_org_idx on public.form_schedules (org_id, active);
create index form_schedules_project_idx on public.form_schedules (project_id, active);

create or replace function app.form_schedules_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare porg uuid; tpl record;
begin
  new.updated_at := now();
  new.subject_person := nullif(btrim(coalesce(new.subject_person, '')), '');
  new.notes := nullif(btrim(coalesce(new.notes, '')), '');
  if new.project_id is not null then
    select org_id into porg from public.projects where id = new.project_id;
    if porg is null or porg <> new.org_id then
      raise exception 'That job is another company''s.' using errcode = 'check_violation';
    end if;
  end if;
  if not exists (select 1 from public.form_templates t where t.org_id = new.org_id and t.code = new.template_code) then
    raise exception 'No form with that code.' using errcode = 'check_violation';
  end if;
  -- What the current issued revision is about decides what the schedule must name.
  select subject into tpl from public.form_templates t where t.org_id = new.org_id and t.code = new.template_code and t.status = 'issued' limit 1;
  if tpl.subject = 'plant' and new.subject_plant_id is null then
    raise exception 'Say which machine the schedule is for.' using errcode = 'check_violation';
  end if;
  if tpl.subject = 'person' and new.subject_person is null then
    raise exception 'Say who the schedule is for.' using errcode = 'check_violation';
  end if;
  if new.subject_plant_id is not null and not exists (select 1 from public.plant_register r where r.id = new.subject_plant_id and r.org_id = new.org_id) then
    raise exception 'That machine is not on the company''s register.' using errcode = 'check_violation';
  end if;
  if new.assigned_to is not null and not exists (
      select 1 from public.project_members pm join public.projects p on p.id = pm.project_id
       where pm.user_id = new.assigned_to and p.org_id = new.org_id and p.active and (new.project_id is null or pm.project_id = new.project_id)) then
    raise exception 'The assignee is someone on the job.' using errcode = 'check_violation';
  end if;
  if tg_op = 'INSERT' then
    new.last_reminded_on := null;
    new.created_by := coalesce(auth.uid(), new.created_by);
    return new;
  end if;
  if new.org_id <> old.org_id or new.project_id is distinct from old.project_id or new.template_code <> old.template_code or new.created_at <> old.created_at then
    raise exception 'A schedule keeps its company, its job and its form.' using errcode = 'check_violation';
  end if;
  -- Only the nightly sweep (service role) stamps the reminder; a signed-in account cannot move it.
  if auth.role() = 'authenticated' then new.last_reminded_on := old.last_reminded_on; end if;
  return new;
end; $$;
create trigger a_form_schedules_before_write before insert or update on public.form_schedules
  for each row execute function app.form_schedules_before_write();

create or replace function app.form_schedules_before_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'A schedule is retired, never deleted — the forms it produced point at it.' using errcode = 'check_violation';
end; $$;
create trigger a_form_schedules_before_delete before delete on public.form_schedules
  for each row execute function app.form_schedules_before_delete();

-- A form started from a schedule says so (the trigger below freezes the link with the rest).
alter table public.form_submissions add column schedule_id uuid references public.form_schedules (id) on delete restrict;
create index form_submissions_schedule_idx on public.form_submissions (schedule_id, status);

-- The next due, counted from the last COMPLETED form the schedule produced; the first due until there is one;
-- null once retired. The SQL twin of `nextDue` in src/lib/forms/schedule.ts — change both together.
create or replace function app.form_next_due(p_schedule uuid)
returns date language sql stable security definer set search_path = '' as $$
  select case
    when not s.active then null
    when d.done is null then s.first_due_on
    when s.unit = 'day' then d.done + s.every
    when s.unit = 'week' then d.done + s.every * 7
    else (d.done + make_interval(months => s.every))::date
  end
  from public.form_schedules s
  left join lateral (
    select max((coalesce(f.completed_on_device_at, f.completed_at) at time zone 'Australia/Perth')::date) as done
      from public.form_submissions f where f.schedule_id = s.id and f.status = 'completed'
  ) d on true
  where s.id = p_schedule;
$$;
grant execute on function app.form_next_due(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. A form started from a schedule says so; the link is frozen with the rest.
-- ---------------------------------------------------------------------------
create or replace function app.form_submissions_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare t public.form_templates%rowtype; org uuid; problems text[]; any_fail boolean; sch record;
begin
  new.updated_at := now();
  new.subject_person := nullif(btrim(coalesce(new.subject_person, '')), '');
  if tg_op = 'INSERT' then
    select * into t from public.form_templates where id = new.template_id;
    select org_id into org from public.projects where id = new.project_id;
    if t.id is null or t.org_id <> org then
      raise exception 'That form is another company''s.' using errcode = 'check_violation';
    end if;
    if t.status <> 'issued' then
      raise exception 'That form is not issued.' using errcode = 'check_violation';
    end if;
    if new.schedule_id is not null then
      select * into sch from public.form_schedules where id = new.schedule_id;
      if sch.id is null or sch.org_id <> org or (sch.project_id is not null and sch.project_id <> new.project_id) then
        raise exception 'That schedule is another job''s.' using errcode = 'check_violation';
      end if;
      if sch.template_code <> t.code then
        raise exception 'That schedule is for another form.' using errcode = 'check_violation';
      end if;
    end if;
    new.template_code := t.code; new.template_title := t.title; new.revision := t.revision; new.category := t.category;
    new.spec := t.spec; new.pass_mark := t.pass_mark; new.signature_rule := t.signature; new.subject := t.subject;
    new.status := 'open'; new.score := null; new.outcome := null;
    new.completed_by := null; new.completed_at := null; new.completed_on_device_at := null; new.signature_path := null;
    new.voided_at := null; new.voided_by := null; new.void_reason := null;
    new.started_by := coalesce(auth.uid(), new.started_by); new.started_at := now();
    return new;
  end if;
  if new.project_id <> old.project_id or new.template_id <> old.template_id or new.started_by <> old.started_by or new.started_at <> old.started_at
     or new.spec <> old.spec or new.template_code <> old.template_code or new.template_title <> old.template_title or new.revision <> old.revision
     or new.category <> old.category or new.pass_mark is distinct from old.pass_mark or new.signature_rule <> old.signature_rule or new.subject <> old.subject
     or new.schedule_id is distinct from old.schedule_id then
    raise exception 'A form keeps its job, its template, its schedule and who started it.' using errcode = 'check_violation';
  end if;
  if old.status = 'voided' then
    raise exception 'A voided form is frozen.' using errcode = 'check_violation';
  end if;
  if old.status = 'completed' then
    -- The one change a completed form takes: the office voids it, with a reason.
    if new.status = 'voided' and new.answers = old.answers and new.header = old.header and new.signature_path is not distinct from old.signature_path
       and new.subject_plant_id is not distinct from old.subject_plant_id and new.subject_person is not distinct from old.subject_person then
      if length(btrim(coalesce(new.void_reason, ''))) = 0 then
        raise exception 'Say why the form is voided.' using errcode = 'check_violation';
      end if;
      select org_id into org from public.projects where id = new.project_id;
      if not app.is_org_office(org) then
        raise exception 'Only the office voids a completed form.' using errcode = 'check_violation';
      end if;
      new.voided_at := now(); new.voided_by := coalesce(auth.uid(), new.voided_by);
      new.completed_at := old.completed_at; new.completed_by := old.completed_by; new.completed_on_device_at := old.completed_on_device_at;
      new.score := old.score; new.outcome := old.outcome;
      return new;
    end if;
    raise exception 'A completed form is frozen.' using errcode = 'check_violation';
  end if;
  -- Open. Saving as it goes, or completing.
  new.voided_at := null; new.voided_by := null; new.void_reason := null;
  if new.status = 'voided' then
    raise exception 'An open form is not voided; leave it or remove it.' using errcode = 'check_violation';
  end if;
  if new.status = 'completed' then
    problems := app.form_completion_problems(new.spec, new.answers);
    if new.subject = 'plant' and new.subject_plant_id is null then problems := problems || 'Which machine the form is about.'; end if;
    if new.subject = 'person' and new.subject_person is null then problems := problems || 'Who the form is about.'; end if;
    if new.signature_rule = 'required' and new.signature_path is null then problems := problems || 'The signature.'; end if;
    if new.signature_path is not null and (split_part(new.signature_path, '/', 1) <> new.project_id::text
       or split_part(new.signature_path, '/', 2) <> 'form' or split_part(new.signature_path, '/', 3) <> new.id::text) then
      problems := problems || 'The signature must be stored in this form''s own folder.';
    end if;
    if array_length(problems, 1) > 0 then
      raise exception 'The form cannot complete: %', array_to_string(problems, ' ') using errcode = 'check_violation';
    end if;
    if new.subject_plant_id is not null and not exists (
      select 1 from public.plant_register r join public.projects p on p.org_id = r.org_id where r.id = new.subject_plant_id and p.id = new.project_id) then
      raise exception 'That machine is not on the company''s register.' using errcode = 'check_violation';
    end if;
    new.completed_at := now(); new.completed_by := coalesce(auth.uid(), new.started_by);
    new.completed_on_device_at := coalesce(new.completed_on_device_at, now());
    new.score := app.form_score(new.spec, new.answers);
    select bool_or(app.form_answer_fails(qq, new.answers -> (qq ->> 'key'))) into any_fail
      from jsonb_array_elements(new.spec -> 'sections') s, jsonb_array_elements(s -> 'questions') qq;
    new.outcome := case when coalesce(any_fail, false) or (new.pass_mark is not null and new.score is not null and new.score < new.pass_mark) then 'fail' else 'pass' end;
  else
    new.status := 'open'; new.completed_at := null; new.completed_by := null; new.completed_on_device_at := null;
    new.score := null; new.outcome := null;
  end if;
  return new;
end; $$;

-- ---------------------------------------------------------------------------
-- 3. The VOC's ticket: a crew_tickets row that names the PASSED form it stands on. The form never writes it —
--    a keeper taps "Record the ticket" (README R181). One ticket per form; the form must be completed, passed,
--    about the person named, and its template must name the competency the ticket is for.
-- ---------------------------------------------------------------------------
alter table public.crew_tickets add column form_submission_id uuid references public.form_submissions (id) on delete restrict;
create unique index crew_tickets_form_once on public.crew_tickets (form_submission_id) where form_submission_id is not null;

create or replace function app.crew_tickets_voc_link()
returns trigger language plpgsql security definer set search_path = '' as $$
declare f record;
begin
  if new.form_submission_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.form_submission_id is not distinct from old.form_submission_id then return new; end if;
  select s.status, s.outcome, s.subject_person, s.completed_on_device_at, s.completed_at, t.competency_key, p.org_id
    into f
    from public.form_submissions s join public.form_templates t on t.id = s.template_id join public.projects p on p.id = s.project_id
   where s.id = new.form_submission_id;
  if f.org_id is null or f.org_id <> new.org_id then
    raise exception 'That form is another company''s.' using errcode = 'check_violation';
  end if;
  if f.status <> 'completed' or f.outcome <> 'pass' then
    raise exception 'A ticket stands on a completed form that passed.' using errcode = 'check_violation';
  end if;
  if f.competency_key is null or f.competency_key <> new.ticket_type then
    raise exception 'That form does not assess this ticket.' using errcode = 'check_violation';
  end if;
  if f.subject_person is null or lower(btrim(f.subject_person)) <> lower(btrim(new.person_name)) then
    raise exception 'The ticket names the person the form assessed.' using errcode = 'check_violation';
  end if;
  new.issued_on := coalesce(new.issued_on, (coalesce(f.completed_on_device_at, f.completed_at) at time zone 'Australia/Perth')::date);
  return new;
end; $$;
create trigger a_crew_tickets_voc_link before insert or update on public.crew_tickets
  for each row execute function app.crew_tickets_voc_link();

-- ---------------------------------------------------------------------------
-- 4. Access. A job's schedule is set by whoever manages the job's incidents (supervisor, PM, admin); a
--    company-wide one by the office. Read with the record — and by the person it is assigned to, whatever their
--    role, so the labourer's home can say a form is due.
-- ---------------------------------------------------------------------------
alter table public.form_schedules enable row level security;

create or replace function app.can_set_form_schedule(p_org uuid, p_project uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select case when p_project is null then app.is_org_office(p_org) else app.can_manage_incidents(p_project) end;
$$;
grant execute on function app.can_set_form_schedule(uuid, uuid) to authenticated;

create policy form_schedules_select on public.form_schedules
  for select to authenticated
  using (app.is_org_member(org_id) and (
    assigned_to = (select auth.uid())
    or (project_id is null and app.reads_org_record(org_id))
    or (project_id is not null and app.reads_record(project_id))));
create policy form_schedules_insert on public.form_schedules
  for insert to authenticated with check (app.can_set_form_schedule(org_id, project_id));
create policy form_schedules_update on public.form_schedules
  for update to authenticated using (app.can_set_form_schedule(org_id, project_id)) with check (app.can_set_form_schedule(org_id, project_id));

grant select, insert, update on public.form_schedules to authenticated;
grant all on public.form_schedules to service_role;
