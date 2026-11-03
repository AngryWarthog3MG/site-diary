-- Training courses and classes (README R188, item 7 of the Stems migration).
--
-- The company's course catalogue: each course a code, a name, a kind (induction, high-risk licence, licence, VET
-- unit, internal, awareness, VOC), its unit of competency, how long it runs, how long it stays current, who provides
-- it, and — where it earns one — the ticket type it stands for (a fixed ticket type or one of the company's own
-- competencies). Classes are sessions of a course on a day: a trainer, a venue, seats; people are BOOKED on them,
-- then marked attended (with a result and the hours) or absent or withdrawn. Nothing here is a ticket: a ticket is
-- a `crew_tickets` row, and one is recorded from an attendance by a tap (`/api/training/classes/[id]/tickets`),
-- never by the class itself — the same line the VOC drew (R181). The ticket names the attendance it stands on
-- (`class_attendee_id`) and the database checks the attendance was a pass, of this person, for this competency.
--
-- Nothing is deleted. A course is retired, a class is cancelled with a reason, a booking is withdrawn.

-- ---------------------------------------------------------------------------
-- 1. Courses
-- ---------------------------------------------------------------------------
create table public.training_courses (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references public.organisations (id) on delete restrict,
  code                  text not null check (code ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,23}$'),
  name                  text not null check (btrim(name) <> ''),
  kind                  text not null check (kind in ('induction', 'high_risk_licence', 'licence', 'vet', 'internal', 'awareness', 'voc', 'other')),
  -- The nationally recognised unit (RIIMPO320F, HLTAID011); free text, because the register is the authority.
  unit_of_competency    text,
  duration_hours        numeric(5, 2) check (duration_hours is null or (duration_hours > 0 and duration_hours <= 999)),
  -- How long the training stays current; null = it does not lapse.
  expiry_months         integer check (expiry_months is null or (expiry_months >= 1 and expiry_months <= 120)),
  provider              text not null default 'internal' check (provider in ('internal', 'external')),
  provider_name         text,
  -- The ticket the course earns: a fixed ticket type or one of the company's own competency keys. Null = none.
  competency_key        text check (competency_key is null or competency_key ~ '^[a-z0-9_]{2,40}$'),
  notes                 text,
  active                boolean not null default true,
  created_by            uuid references auth.users (id) default auth.uid(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create unique index training_courses_code_once on public.training_courses (org_id, lower(code));
create index training_courses_org on public.training_courses (org_id, active);

create or replace function app.training_courses_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.code := btrim(new.code);
  new.name := regexp_replace(btrim(new.name), '\s+', ' ', 'g');
  new.unit_of_competency := nullif(btrim(coalesce(new.unit_of_competency, '')), '');
  new.provider_name := nullif(btrim(coalesce(new.provider_name, '')), '');
  new.notes := nullif(btrim(coalesce(new.notes, '')), '');
  if new.provider = 'external' and new.provider_name is null then
    raise exception 'An external course names its provider.' using errcode = 'check_violation';
  end if;
  -- A custom competency key must be one of the company's own; the fixed ticket types are the app's and not in a table.
  if new.competency_key is not null
     and new.competency_key not in ('white_card', 'c_licence', 'mr_licence', 'hr_licence', 'hc_licence', 'excavator', 'roller', 'loader', 'forklift', 'ewp', 'first_aid', 'working_at_heights', 'confined_space', 'traffic_control', 'chainsaw')
     and not exists (select 1 from public.org_competencies c where c.org_id = new.org_id and c.key = new.competency_key) then
    raise exception 'That competency is not one the company keeps.' using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' then
    if new.org_id <> old.org_id then raise exception 'A course stays with its company.' using errcode = 'check_violation'; end if;
    new.created_by := old.created_by; new.created_at := old.created_at;
    new.updated_at := now();
  end if;
  return new;
end; $$;
create trigger a_training_courses_before_write before insert or update on public.training_courses
  for each row execute function app.training_courses_before_write();

create or replace function app.frozen_row_training()
returns trigger language plpgsql as $$
begin
  raise exception 'Training records are never deleted — retire the course, cancel the class, withdraw the booking.' using errcode = 'check_violation';
end; $$;
create trigger a_training_courses_no_delete before delete on public.training_courses
  for each row execute function app.frozen_row_training();

-- ---------------------------------------------------------------------------
-- 2. Classes — a session of a course
-- ---------------------------------------------------------------------------
create table public.training_classes (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organisations (id) on delete restrict,
  course_id         uuid not null references public.training_courses (id) on delete restrict,
  -- Where it is held, when it is a job's: the job's screens list it first. Null = the company's (the yard, a venue).
  project_id        uuid references public.projects (id) on delete restrict,
  starts_at         timestamptz not null,
  ends_at           timestamptz check (ends_at is null or ends_at > starts_at),
  venue             text,
  trainer_name      text,
  capacity          integer check (capacity is null or (capacity >= 1 and capacity <= 500)),
  status            text not null default 'scheduled' check (status in ('scheduled', 'held', 'cancelled')),
  held_at           timestamptz,
  cancelled_at      timestamptz,
  cancelled_reason  text,
  notes             text,
  created_by        uuid references auth.users (id) default auth.uid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint training_classes_cancel_whole check ((status = 'cancelled') = (cancelled_reason is not null))
);
create index training_classes_org_day on public.training_classes (org_id, starts_at);
create index training_classes_course on public.training_classes (course_id);

/** Hours a class runs, from its own clocks; null when it has no end. */
create or replace function app.training_class_span_hours(p_class uuid)
returns numeric language sql stable security definer set search_path = '' as $$
  select round(extract(epoch from (c.ends_at - c.starts_at)) / 3600.0, 2)
    from public.training_classes c where c.id = p_class and c.ends_at is not null;
$$;
grant execute on function app.training_class_span_hours(uuid) to authenticated;

create or replace function app.training_classes_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_course_org uuid; v_project_org uuid;
begin
  new.venue := nullif(regexp_replace(btrim(coalesce(new.venue, '')), '\s+', ' ', 'g'), '');
  new.trainer_name := nullif(regexp_replace(btrim(coalesce(new.trainer_name, '')), '\s+', ' ', 'g'), '');
  new.cancelled_reason := nullif(btrim(coalesce(new.cancelled_reason, '')), '');
  new.notes := nullif(btrim(coalesce(new.notes, '')), '');
  select org_id into v_course_org from public.training_courses where id = new.course_id;
  if v_course_org is null or v_course_org <> new.org_id then
    raise exception 'That course is another company''s.' using errcode = 'check_violation';
  end if;
  if new.project_id is not null then
    select org_id into v_project_org from public.projects where id = new.project_id;
    if v_project_org is null or v_project_org <> new.org_id then
      raise exception 'That job is another company''s.' using errcode = 'check_violation';
    end if;
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'scheduled' then raise exception 'A class is born scheduled.' using errcode = 'check_violation'; end if;
    new.held_at := null; new.cancelled_at := null;
    return new;
  end if;
  -- UPDATE
  if new.org_id <> old.org_id or new.course_id <> old.course_id then
    raise exception 'A class keeps its course and its company.' using errcode = 'check_violation';
  end if;
  new.created_by := old.created_by; new.created_at := old.created_at; new.updated_at := old.updated_at;
  if old.status <> 'scheduled' then
    if row(new.*) is distinct from row(old.*) then
      raise exception 'A % class is frozen.', old.status using errcode = 'check_violation';
    end if;
    return old;
  end if;
  new.updated_at := now();
  if new.status = 'held' then
    if new.starts_at > now() then raise exception 'A class is held once it has started.' using errcode = 'check_violation'; end if;
    new.held_at := now();
  elsif new.status = 'cancelled' then
    new.cancelled_at := now();
  else
    new.held_at := null; new.cancelled_at := null;
  end if;
  return new;
end; $$;
create trigger a_training_classes_before_write before insert or update on public.training_classes
  for each row execute function app.training_classes_before_write();
create trigger a_training_classes_no_delete before delete on public.training_classes
  for each row execute function app.frozen_row_training();

-- ---------------------------------------------------------------------------
-- 3. Attendees — booked, then attended / absent / withdrawn
-- ---------------------------------------------------------------------------
create table public.training_class_attendees (
  id            uuid primary key default gen_random_uuid(),
  class_id      uuid not null references public.training_classes (id) on delete restrict,
  -- The name on the sheets (R70/R123): the staff list's spelling where the person is on it.
  person_name   text not null check (btrim(person_name) <> ''),
  status        text not null default 'booked' check (status in ('booked', 'attended', 'absent', 'withdrawn')),
  -- Attended: the hours of training the person received. Given, else the class's span, else the course's
  -- duration, else null — "not recorded", never 0.
  hours         numeric(5, 2) check (hours is null or (hours > 0 and hours <= 999)),
  -- Attended: competent / not yet competent. Null = the course does not assess.
  result        text check (result is null or result in ('pass', 'fail')),
  notes         text,
  booked_by     uuid references auth.users (id) default auth.uid(),
  booked_at     timestamptz not null default now(),
  marked_by     uuid references auth.users (id),
  marked_at     timestamptz,
  constraint training_attendees_mark_whole check ((status in ('attended', 'absent', 'withdrawn')) = (marked_at is not null)),
  constraint training_attendees_result_when_attended check (status = 'attended' or (result is null and hours is null))
);
create unique index training_attendees_once on public.training_class_attendees (class_id, lower(regexp_replace(btrim(person_name), '\s+', ' ', 'g')));
create index training_attendees_class on public.training_class_attendees (class_id, status);

create or replace function app.training_attendee_org(p_attendee uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select c.org_id from public.training_class_attendees a join public.training_classes c on c.id = a.class_id where a.id = p_attendee;
$$;
grant execute on function app.training_attendee_org(uuid) to authenticated;

create or replace function app.training_class_org(p_class uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select c.org_id from public.training_classes c where c.id = p_class;
$$;
grant execute on function app.training_class_org(uuid) to authenticated;

create or replace function app.training_attendees_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_class record; v_booked integer;
begin
  new.person_name := regexp_replace(btrim(new.person_name), '\s+', ' ', 'g');
  new.notes := nullif(btrim(coalesce(new.notes, '')), '');
  select c.status, c.capacity, c.starts_at, c.ends_at, k.duration_hours
    into v_class
    from public.training_classes c join public.training_courses k on k.id = c.course_id
   where c.id = new.class_id;
  if v_class is null then raise exception 'No such class.' using errcode = 'check_violation'; end if;
  if tg_op = 'INSERT' then
    if v_class.status = 'cancelled' then raise exception 'That class was cancelled.' using errcode = 'check_violation'; end if;
    if new.status <> 'booked' then raise exception 'A person is booked first, then marked.' using errcode = 'check_violation'; end if;
    if v_class.capacity is not null then
      select count(*) into v_booked from public.training_class_attendees a where a.class_id = new.class_id and a.status in ('booked', 'attended');
      if v_booked >= v_class.capacity then
        raise exception 'The class is full (% seats).', v_class.capacity using errcode = 'check_violation';
      end if;
    end if;
    new.marked_by := null; new.marked_at := null; new.hours := null; new.result := null;
    return new;
  end if;
  -- UPDATE
  if new.class_id <> old.class_id or lower(new.person_name) <> lower(old.person_name) then
    raise exception 'A booking keeps its class and its person.' using errcode = 'check_violation';
  end if;
  new.booked_by := old.booked_by; new.booked_at := old.booked_at;
  if old.status <> 'booked' then
    if row(new.*) is distinct from row(old.*) then
      raise exception 'A % booking is frozen.', old.status using errcode = 'check_violation';
    end if;
    return old;
  end if;
  if new.status = 'booked' then
    new.marked_by := null; new.marked_at := null; new.hours := null; new.result := null;
    return new;
  end if;
  -- Marking: the DB stamps who and when; attended fills the hours from the class, then the course, never a guess.
  new.marked_by := auth.uid(); new.marked_at := now();
  if new.status = 'attended' then
    if v_class.status = 'cancelled' then raise exception 'Nobody attends a cancelled class.' using errcode = 'check_violation'; end if;
    if v_class.starts_at > now() then raise exception 'A class is attended once it has started.' using errcode = 'check_violation'; end if;
    new.hours := coalesce(new.hours, app.training_class_span_hours(new.class_id), v_class.duration_hours);
  else
    new.hours := null; new.result := null;
  end if;
  return new;
end; $$;
create trigger a_training_attendees_before_write before insert or update on public.training_class_attendees
  for each row execute function app.training_attendees_before_write();
create trigger a_training_attendees_no_delete before delete on public.training_class_attendees
  for each row execute function app.frozen_row_training();

-- ---------------------------------------------------------------------------
-- 4. The ticket an attendance earns — recorded by a tap, checked by the database (mirrors the VOC's
--    `form_submission_id`, R181). One ticket per attendance.
-- ---------------------------------------------------------------------------
alter table public.crew_tickets add column class_attendee_id uuid references public.training_class_attendees (id) on delete restrict;
create unique index crew_tickets_class_once on public.crew_tickets (class_attendee_id) where class_attendee_id is not null;

create or replace function app.crew_tickets_class_link()
returns trigger language plpgsql security definer set search_path = '' as $$
declare f record;
begin
  if new.class_attendee_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.class_attendee_id is not distinct from old.class_attendee_id then return new; end if;
  select a.status, a.result, a.person_name, c.starts_at, c.org_id, k.competency_key, k.expiry_months
    into f
    from public.training_class_attendees a
    join public.training_classes c on c.id = a.class_id
    join public.training_courses k on k.id = c.course_id
   where a.id = new.class_attendee_id;
  if f.org_id is null or f.org_id <> new.org_id then
    raise exception 'That class is another company''s.' using errcode = 'check_violation';
  end if;
  if f.status <> 'attended' or f.result is distinct from 'pass' then
    raise exception 'A ticket stands on an attendance marked competent.' using errcode = 'check_violation';
  end if;
  if f.competency_key is null or f.competency_key <> new.ticket_type then
    raise exception 'That course does not earn this ticket.' using errcode = 'check_violation';
  end if;
  if lower(btrim(f.person_name)) <> lower(btrim(new.person_name)) then
    raise exception 'The ticket names the person who attended.' using errcode = 'check_violation';
  end if;
  new.issued_on := coalesce(new.issued_on, (f.starts_at at time zone 'Australia/Perth')::date);
  if new.expires_on is null and f.expiry_months is not null then
    new.expires_on := (new.issued_on + make_interval(months => f.expiry_months))::date;
  end if;
  return new;
end; $$;
create trigger a_crew_tickets_class_link before insert or update on public.crew_tickets
  for each row execute function app.crew_tickets_class_link();

-- ---------------------------------------------------------------------------
-- 5. Access. The catalogue and the classes are kept by whoever keeps the company's tickets
--    (`app.can_manage_crew`: supervisor, PM or admin anywhere in the company — the same hands that record the
--    ticket, so a tap that records one never meets a second rule). Reads follow the record: every member behind
--    `app.reads_org_record` — the labourer reads none of it.
-- ---------------------------------------------------------------------------
create or replace function app.can_keep_training(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.can_manage_crew(p_org);
$$;
grant execute on function app.can_keep_training(uuid) to authenticated;

alter table public.training_courses enable row level security;
alter table public.training_classes enable row level security;
alter table public.training_class_attendees enable row level security;

create policy training_courses_select on public.training_courses for select to authenticated using (app.is_org_member(org_id));
create policy training_courses_reads_record on public.training_courses as restrictive for select to authenticated using (app.reads_org_record(org_id));
create policy training_courses_insert on public.training_courses for insert to authenticated with check (app.can_keep_training(org_id));
create policy training_courses_update on public.training_courses for update to authenticated using (app.can_keep_training(org_id)) with check (app.can_keep_training(org_id));

create policy training_classes_select on public.training_classes for select to authenticated using (app.is_org_member(org_id));
create policy training_classes_reads_record on public.training_classes as restrictive for select to authenticated using (app.reads_org_record(org_id));
create policy training_classes_insert on public.training_classes for insert to authenticated with check (app.can_keep_training(org_id));
create policy training_classes_update on public.training_classes for update to authenticated using (app.can_keep_training(org_id)) with check (app.can_keep_training(org_id));

create policy training_attendees_select on public.training_class_attendees for select to authenticated using (app.is_org_member(app.training_class_org(class_id)));
create policy training_attendees_reads_record on public.training_class_attendees as restrictive for select to authenticated using (app.reads_org_record(app.training_class_org(class_id)));
create policy training_attendees_insert on public.training_class_attendees for insert to authenticated with check (app.can_keep_training(app.training_class_org(class_id)));
create policy training_attendees_update on public.training_class_attendees for update to authenticated using (app.can_keep_training(app.training_class_org(class_id))) with check (app.can_keep_training(app.training_class_org(class_id)));

grant select, insert, update on public.training_courses, public.training_classes, public.training_class_attendees to authenticated;
grant all on public.training_courses, public.training_classes, public.training_class_attendees to service_role;

comment on table public.training_courses is 'The company''s course catalogue (README R188). Retired, never deleted.';
comment on table public.training_classes is 'A session of a course: scheduled → held | cancelled (with a reason), then frozen (README R188).';
comment on table public.training_class_attendees is 'Who is booked on a class and what came of it: booked → attended (hours, result) | absent | withdrawn, then frozen. A ticket is recorded from an attendance by a tap, never by the class (README R188).';
