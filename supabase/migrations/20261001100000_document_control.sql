-- Document control, brought up to the standard of the management system it replaces (README R120).
--
-- What a policy or procedure now carries: who must read it (an audience of roles — empty means everyone on the
-- company's jobs), how many days they get, how often it is reviewed, and a comprehension check with a pass mark. What
-- issuing does: every person in the audience gets an ASSIGNMENT with a due date, older versions' pending assignments
-- are superseded, and an event is written. What signing does: a person acknowledges FOR THEMSELVES, by their own
-- name, having passed the check where there is one; the assignment is marked signed by the database. A supervisor
-- may still record a crew member's signature by hand (people without accounts), as before. Reminders and
-- notifications are the server's (nightly `documents=1`, and at issue); the stamps they leave are here.
--
-- Drafts: a version is born a draft, so questions can be set and a bulk import can land without telling anyone;
-- issuing it (draft → current) is the moment that supersedes, assigns and notifies. Issued = frozen, as before.
--
-- Reads: every member of the company may read the documents and their current version — a policy is for the people
-- it binds, the labourer included; acknowledgements stay behind the record lock except one's own.

-- ---------------------------------------------------------------------------------------------------------------
-- 1. The document: audience, due days, review, pass mark.
alter table public.controlled_documents
  add column audience text[] not null default '{}',
  add column ack_due_days integer not null default 14 check (ack_due_days between 1 and 365),
  add column review_interval_months integer check (review_interval_months is null or review_interval_months between 1 and 120),
  add column next_review_on date,
  add column pass_mark integer check (pass_mark is null or pass_mark in (50, 70, 80, 100));
comment on column public.controlled_documents.audience is 'Roles that must read and sign it; empty = every member of the company''s jobs. README R120.';

create or replace function app.controlled_documents_touch()
returns trigger language plpgsql set search_path = '' as $$
declare v_roles text[] := enum_range(null::public.member_role)::text[];
begin
  new.title := regexp_replace(btrim(new.title), '\s+', ' ', 'g');
  new.doc_number := nullif(btrim(coalesce(new.doc_number, '')), '');
  if not (coalesce(new.audience, '{}') <@ v_roles) then
    raise exception 'The audience names a role that does not exist.' using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  return new;
end; $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 2. Versions: a draft state before issue.
do $$
declare c text;
begin
  select conname into c from pg_constraint
   where conrelid = 'public.document_versions'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%status%';
  if c is not null then execute format('alter table public.document_versions drop constraint %I', c); end if;
end $$;
alter table public.document_versions add constraint document_versions_status_check check (status in ('draft', 'current', 'superseded'));
alter table public.document_versions alter column issued_at drop not null;
alter table public.document_versions add column change_summary text;

create or replace function app.document_versions_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  perform pg_advisory_xact_lock(hashtext('docver:' || new.document_id::text));
  select coalesce(max(version), 0) + 1 into new.version from public.document_versions where document_id = new.document_id;
  select org_id into v_org from public.controlled_documents where id = new.document_id;
  if split_part(new.file_path, '/', 1) <> v_org::text or split_part(new.file_path, '/', 2) <> new.document_id::text then
    raise exception 'The file must be stored in this document''s own folder.' using errcode = 'check_violation';
  end if;
  new.superseded_at := null;
  if coalesce(new.status, 'current') = 'draft' then
    new.status := 'draft';
    new.issued_at := null;
    new.issued_by := null;
    return new;
  end if;
  new.status := 'current';
  new.issued_at := now();
  new.issued_by := coalesce(new.issued_by, auth.uid());
  update public.document_versions set status = 'superseded', superseded_at = now()
   where document_id = new.document_id and status = 'current';
  return new;
end; $$;

create or replace function app.document_versions_before_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.document_id is distinct from old.document_id or new.version is distinct from old.version or new.file_path is distinct from old.file_path then
    raise exception 'A version keeps its number and its file; issue a new one.' using errcode = 'check_violation';
  end if;
  if old.status = 'draft' then
    if new.status = 'current' then
      -- Issued now: the moment that supersedes the last one. The after-trigger assigns.
      new.issued_at := now();
      new.issued_by := coalesce(new.issued_by, auth.uid());
      new.superseded_at := null;
      update public.document_versions set status = 'superseded', superseded_at = now()
       where document_id = new.document_id and status = 'current' and id <> new.id;
    elsif new.status = 'superseded' then
      raise exception 'A draft is issued or left; it is not superseded.' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if new.summary is distinct from old.summary or new.change_summary is distinct from old.change_summary
     or new.issued_at is distinct from old.issued_at or new.issued_by is distinct from old.issued_by then
    raise exception 'An issued version is frozen; issue a new one.' using errcode = 'check_violation';
  end if;
  if old.status = 'superseded' and new.status = 'current' then
    raise exception 'A superseded version does not come back; issue it again as a new version.' using errcode = 'check_violation';
  end if;
  if old.status = 'current' and new.status = 'draft' then
    raise exception 'An issued version does not go back to draft.' using errcode = 'check_violation';
  end if;
  return new;
end; $$;

-- Only the current version is acknowledged — a draft is nobody's yet.
create or replace function app.document_acknowledgements_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_status text;
begin
  select d.org_id, v.status into v_org, v_status from public.document_versions v join public.controlled_documents d on d.id = v.document_id where v.id = new.version_id;
  if v_org is null then raise exception 'No such version.' using errcode = 'check_violation'; end if;
  if v_status = 'draft' then raise exception 'This version has not been issued yet.' using errcode = 'check_violation'; end if;
  if v_status <> 'current' then
    raise exception 'Only the current version is acknowledged; this one is superseded.' using errcode = 'check_violation';
  end if;
  if new.project_id is not null and not exists (select 1 from public.projects p where p.id = new.project_id and p.org_id = v_org) then
    raise exception 'The job and the document belong to different organisations.' using errcode = 'check_violation';
  end if;
  new.person_name := regexp_replace(btrim(new.person_name), '\s+', ' ', 'g');
  if split_part(new.signature_path, '/', 1) <> coalesce(new.project_id::text, '') or split_part(new.signature_path, '/', 2) <> 'document'
     or split_part(new.signature_path, '/', 3) <> new.id::text then
    raise exception 'The signature must be stored in this acknowledgement''s own folder.' using errcode = 'check_violation';
  end if;
  return new;
end; $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 3. Assignments: who must sign which version, by when.
create table public.document_assignments (
  id                 uuid primary key default gen_random_uuid(),
  version_id         uuid not null references public.document_versions (id) on delete restrict,
  user_id            uuid not null references auth.users (id) on delete restrict,
  assigned_at        timestamptz not null default now(),
  due_on             date not null,
  status             text not null default 'pending' check (status in ('pending', 'signed', 'superseded', 'waived')),
  signed_at          timestamptz,
  acknowledgement_id uuid references public.document_acknowledgements (id),
  waived_by          uuid references auth.users (id),
  waived_at          timestamptz,
  waive_reason       text,
  last_reminded_at   timestamptz,
  reminder_count     integer not null default 0,
  unique (version_id, user_id)
);
create index document_assignments_user_idx on public.document_assignments (user_id, status);
create index document_assignments_version_idx on public.document_assignments (version_id, status);

-- The questions a version asks, and the answers people gave.
create table public.document_questions (
  id            uuid primary key default gen_random_uuid(),
  version_id    uuid not null references public.document_versions (id) on delete restrict,
  position      integer not null check (position between 1 and 50),
  prompt        text not null check (length(btrim(prompt)) > 0),
  options       text[] not null check (array_length(options, 1) between 2 and 6),
  correct_index integer not null check (correct_index >= 0),
  unique (version_id, position),
  check (correct_index < array_length(options, 1))
);
create table public.document_quiz_attempts (
  id          uuid primary key default gen_random_uuid(),
  version_id  uuid not null references public.document_versions (id) on delete restrict,
  user_id     uuid not null references auth.users (id) on delete restrict,
  answers     integer[] not null,
  score       integer not null,
  total       integer not null,
  passed      boolean not null,
  created_at  timestamptz not null default now()
);
create index document_quiz_attempts_idx on public.document_quiz_attempts (version_id, user_id, created_at desc);

-- What happened to a document, in order, kept.
create table public.document_events (
  id           bigint generated always as identity primary key,
  document_id  uuid not null references public.controlled_documents (id) on delete restrict,
  version_id   uuid references public.document_versions (id) on delete restrict,
  subject_id   uuid references auth.users (id),
  actor_id     uuid references auth.users (id),
  kind         text not null check (kind in ('drafted', 'issued', 'assigned', 'notified', 'reminded', 'signed', 'quiz_passed', 'quiz_failed', 'waived', 'superseded')),
  detail       text,
  at           timestamptz not null default now()
);
create index document_events_doc_idx on public.document_events (document_id, at desc);
create index document_events_subject_idx on public.document_events (subject_id, at desc);
create trigger a_document_events_frozen before update or delete on public.document_events for each row execute function app.frozen_row();

-- The acknowledgement grew: the name typed, time on the page, the attempt that let it through.
alter table public.document_acknowledgements
  add column typed_name text,
  add column time_on_page_s integer check (time_on_page_s is null or time_on_page_s >= 0),
  add column quiz_attempt_id uuid references public.document_quiz_attempts (id);

-- ---------------------------------------------------------------------------------------------------------------
-- 4. Who is in the audience, and assigning them.
create or replace function app.document_audience(p_document uuid)
returns table (user_id uuid) language sql stable security definer set search_path = '' as $$
  select distinct pm.user_id
    from public.controlled_documents d
    join public.projects p on p.org_id = d.org_id and p.active
    join public.project_members pm on pm.project_id = p.id
   where d.id = p_document
     and (coalesce(array_length(d.audience, 1), 0) = 0 or pm.role::text = any (d.audience));
$$;

create or replace function app.assign_document_version(p_version uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_doc uuid; v_due date; v_requires boolean; v_n integer := 0; v_actor uuid := auth.uid();
begin
  select v.document_id, d.requires_acknowledgement, app.perth_today() + d.ack_due_days
    into v_doc, v_requires, v_due
    from public.document_versions v join public.controlled_documents d on d.id = v.document_id where v.id = p_version;
  if v_doc is null then return 0; end if;
  -- The last version's unfinished business is closed: they read the new words now.
  update public.document_assignments a set status = 'superseded'
   where a.status = 'pending' and a.version_id in (select id from public.document_versions where document_id = v_doc and id <> p_version);
  insert into public.document_events (document_id, version_id, actor_id, kind) values (v_doc, p_version, v_actor, 'issued');
  if not v_requires then return 0; end if;
  insert into public.document_assignments (version_id, user_id, due_on)
  select p_version, u.user_id, v_due from app.document_audience(v_doc) u
  on conflict (version_id, user_id) do nothing;
  get diagnostics v_n = row_count;
  insert into public.document_events (document_id, version_id, actor_id, kind, detail) values (v_doc, p_version, v_actor, 'assigned', v_n || ' people');
  return v_n;
end; $$;

create or replace function app.document_versions_after_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'current' and (tg_op = 'INSERT' or old.status = 'draft') then perform app.assign_document_version(new.id); end if;
  if tg_op = 'INSERT' and new.status = 'draft' then
    insert into public.document_events (document_id, version_id, actor_id, kind) values (new.document_id, new.id, auth.uid(), 'drafted');
  end if;
  return null;
end; $$;
create trigger b_document_versions_after_write after insert or update on public.document_versions
  for each row execute function app.document_versions_after_write();

-- A person put on a job joins the audience of every current document their role must read.
create or replace function app.assign_current_documents_to(p_user uuid, p_org uuid, p_role text)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_n integer := 0;
begin
  insert into public.document_assignments (version_id, user_id, due_on)
  select v.id, p_user, app.perth_today() + d.ack_due_days
    from public.controlled_documents d join public.document_versions v on v.document_id = d.id and v.status = 'current'
   where d.org_id = p_org and d.active and d.requires_acknowledgement
     and (coalesce(array_length(d.audience, 1), 0) = 0 or p_role = any (d.audience))
     and not exists (select 1 from public.document_acknowledgements a where a.version_id = v.id and a.recorded_by = p_user
                       and regexp_replace(lower(btrim(a.person_name)), '\s+', ' ', 'g') = (select regexp_replace(lower(btrim(coalesce(pr.full_name, ''))), '\s+', ' ', 'g') from public.profiles pr where pr.id = p_user))
  on conflict (version_id, user_id) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end; $$;

create or replace function app.project_members_assign_documents()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  select org_id into v_org from public.projects where id = new.project_id;
  perform app.assign_current_documents_to(new.user_id, v_org, new.role::text);
  return null;
end; $$;
create trigger project_members_assign_documents after insert on public.project_members
  for each row execute function app.project_members_assign_documents();

-- ---------------------------------------------------------------------------------------------------------------
-- 5. Signing: an acknowledgement closes the assignment. Matched to the person who recorded it when it is their own
--    name; otherwise to the member whose name it is (a supervisor recording the crew).
create or replace function app.document_acknowledgements_after_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_user uuid; v_doc uuid; v_org uuid;
  v_name text := regexp_replace(lower(btrim(new.person_name)), '\s+', ' ', 'g');
begin
  select v.document_id, d.org_id into v_doc, v_org from public.document_versions v join public.controlled_documents d on d.id = v.document_id where v.id = new.version_id;
  select pr.id into v_user from public.profiles pr where pr.id = new.recorded_by
     and regexp_replace(lower(btrim(coalesce(pr.full_name, ''))), '\s+', ' ', 'g') = v_name;
  if v_user is null then
    select pr.id into v_user
      from public.profiles pr
     where regexp_replace(lower(btrim(coalesce(pr.full_name, ''))), '\s+', ' ', 'g') = v_name
       and exists (select 1 from public.project_members pm join public.projects p on p.id = pm.project_id where pm.user_id = pr.id and p.org_id = v_org)
     limit 1;
  end if;
  if v_user is not null then
    update public.document_assignments set status = 'signed', signed_at = coalesce(new.acknowledged_on_device_at, now()), acknowledgement_id = new.id
     where version_id = new.version_id and user_id = v_user and status = 'pending';
  end if;
  insert into public.document_events (document_id, version_id, subject_id, actor_id, kind, detail)
  values (v_doc, new.version_id, v_user, new.recorded_by, 'signed', new.person_name);
  return null;
end; $$;
create trigger b_document_acknowledgements_after_insert after insert on public.document_acknowledgements
  for each row execute function app.document_acknowledgements_after_insert();

-- May this caller sign this version as themselves? Their own name, a current version, a job they hold, and the
-- comprehension check passed where the version asks questions.
create or replace function app.can_ack_own_document(p_version uuid, p_name text, p_project uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.document_versions v
      join public.controlled_documents d on d.id = v.document_id
      join public.profiles pr on pr.id = (select auth.uid())
     where v.id = p_version and v.status = 'current'
       and regexp_replace(lower(btrim(coalesce(pr.full_name, ''))), '\s+', ' ', 'g') = regexp_replace(lower(btrim(p_name)), '\s+', ' ', 'g')
       and app.is_project_member(p_project)
       and exists (select 1 from public.projects p where p.id = p_project and p.org_id = d.org_id)
       and (not exists (select 1 from public.document_questions q where q.version_id = p_version)
            or exists (select 1 from public.document_quiz_attempts a where a.version_id = p_version and a.user_id = (select auth.uid()) and a.passed)));
$$;
grant execute on function app.can_ack_own_document(uuid, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- 6. The comprehension check: graded here, so the right answers never reach a phone.
create or replace function public.answer_document_quiz(p_version uuid, p_answers integer[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_total integer; v_score integer := 0; v_pass integer; v_doc uuid; v_org uuid; v_passed boolean; v_id uuid; q record;
begin
  select v.document_id, d.org_id, coalesce(d.pass_mark, 100) into v_doc, v_org, v_pass
    from public.document_versions v join public.controlled_documents d on d.id = v.document_id where v.id = p_version;
  if v_doc is null or not app.is_org_member(v_org) then
    raise exception 'That document is not on your account.' using errcode = 'insufficient_privilege';
  end if;
  select count(*) into v_total from public.document_questions where version_id = p_version;
  if v_total = 0 then raise exception 'This version asks no questions.' using errcode = 'check_violation'; end if;
  if coalesce(array_length(p_answers, 1), 0) <> v_total then
    raise exception 'Answer every question.' using errcode = 'check_violation';
  end if;
  for q in select position, correct_index from public.document_questions where version_id = p_version order by position loop
    if p_answers[q.position] = q.correct_index then v_score := v_score + 1; end if;
  end loop;
  v_passed := (v_score * 100) >= (v_pass * v_total);
  insert into public.document_quiz_attempts (version_id, user_id, answers, score, total, passed)
  values (p_version, auth.uid(), p_answers, v_score, v_total, v_passed) returning id into v_id;
  insert into public.document_events (document_id, version_id, subject_id, actor_id, kind, detail)
  values (v_doc, p_version, auth.uid(), auth.uid(), case when v_passed then 'quiz_passed' else 'quiz_failed' end, v_score || ' of ' || v_total);
  return jsonb_build_object('attempt_id', v_id, 'score', v_score, 'total', v_total, 'passed', v_passed, 'pass_mark', v_pass);
end; $$;
revoke all on function public.answer_document_quiz(uuid, integer[]) from public, anon;
grant execute on function public.answer_document_quiz(uuid, integer[]) to authenticated, service_role;

-- The answer key, for those who set the questions.
create or replace function public.document_answer_key(p_version uuid)
returns table (question_no integer, correct_index integer) language sql stable security definer set search_path = '' as $$
  select q.position, q.correct_index from public.document_questions q
   where q.version_id = p_version and app.can_manage_crew(app.version_org(p_version)) order by q.position;
$$;
revoke all on function public.document_answer_key(uuid) from public, anon;
grant execute on function public.document_answer_key(uuid) to authenticated, service_role;

-- Questions belong to a draft. Once the version is issued they are part of it and do not change.
create or replace function app.document_questions_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_status text; v_version uuid := coalesce(new.version_id, old.version_id);
begin
  select status into v_status from public.document_versions where id = v_version;
  if v_status is distinct from 'draft' then
    raise exception 'Questions are set on a draft; an issued version''s questions are frozen.' using errcode = 'check_violation';
  end if;
  if tg_op = 'INSERT' then
    new.prompt := btrim(new.prompt);
    new.options := (select array_agg(btrim(o)) from unnest(new.options) o);
  end if;
  return coalesce(new, old);
end; $$;
create trigger a_document_questions_guard before insert or update or delete on public.document_questions
  for each row execute function app.document_questions_guard();
create trigger a_document_quiz_attempts_frozen before update or delete on public.document_quiz_attempts for each row execute function app.frozen_row();

-- Waiving, reminding: the stamps are the only columns a manager changes on an assignment.
create or replace function app.document_assignments_before_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.version_id <> old.version_id or new.user_id <> old.user_id or new.assigned_at <> old.assigned_at then
    raise exception 'An assignment keeps its person and version.' using errcode = 'check_violation';
  end if;
  if old.status in ('signed', 'superseded') and new.status <> old.status then
    raise exception 'A signed or superseded assignment does not change.' using errcode = 'check_violation';
  end if;
  if new.status = 'waived' and old.status <> 'waived' then
    if nullif(btrim(coalesce(new.waive_reason, '')), '') is null then raise exception 'Say why it is waived.' using errcode = 'check_violation'; end if;
    new.waived_by := auth.uid(); new.waived_at := now();
    insert into public.document_events (document_id, version_id, subject_id, actor_id, kind, detail)
    select v.document_id, v.id, new.user_id, auth.uid(), 'waived', new.waive_reason from public.document_versions v where v.id = new.version_id;
  end if;
  return new;
end; $$;
create trigger a_document_assignments_before_update before update on public.document_assignments
  for each row execute function app.document_assignments_before_update();
create trigger a_document_assignments_no_delete before delete on public.document_assignments for each row execute function app.frozen_row();

-- Reminder sent (the server, under the service role, or a manager): stamped and counted.
create or replace function public.record_document_reminder(p_assignment uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_version uuid; v_user uuid; v_doc uuid;
begin
  select a.version_id, a.user_id, v.document_id into v_version, v_user, v_doc
    from public.document_assignments a join public.document_versions v on v.id = a.version_id where a.id = p_assignment;
  if v_doc is null then return; end if;
  if current_user <> 'service_role' and not app.can_manage_crew(app.version_org(v_version)) then
    raise exception 'Only a manager sends reminders.' using errcode = 'insufficient_privilege';
  end if;
  update public.document_assignments set last_reminded_at = now(), reminder_count = reminder_count + 1 where id = p_assignment;
  insert into public.document_events (document_id, version_id, subject_id, actor_id, kind) values (v_doc, v_version, v_user, auth.uid(), 'reminded');
end; $$;
revoke all on function public.record_document_reminder(uuid) from public, anon;
grant execute on function public.record_document_reminder(uuid) to authenticated, service_role;

create or replace function public.record_document_notified(p_version uuid, p_detail text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_doc uuid;
begin
  select document_id into v_doc from public.document_versions where id = p_version;
  if v_doc is null then return; end if;
  if current_user <> 'service_role' and not app.can_manage_crew(app.version_org(p_version)) then
    raise exception 'Only a manager records this.' using errcode = 'insufficient_privilege';
  end if;
  insert into public.document_events (document_id, version_id, actor_id, kind, detail) values (v_doc, p_version, auth.uid(), 'notified', p_detail);
end; $$;
revoke all on function public.record_document_notified(uuid, text) from public, anon;
grant execute on function public.record_document_notified(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- 7. Who reads and writes what.
alter table public.document_assignments enable row level security;
alter table public.document_questions enable row level security;
alter table public.document_quiz_attempts enable row level security;
alter table public.document_events enable row level security;

-- The documents are for the people they bind: every member reads them, the labourer included.
drop policy controlled_documents_reads_record on public.controlled_documents;
drop policy document_versions_reads_record on public.document_versions;
drop policy document_acknowledgements_reads_record on public.document_acknowledgements;
create policy document_acknowledgements_reads_record on public.document_acknowledgements as restrictive for select to authenticated
  using (app.reads_org_record(app.version_org(version_id)) or recorded_by = (select auth.uid()));
-- A draft is the office's until it is issued.
create policy document_versions_drafts_managers on public.document_versions as restrictive for select to authenticated
  using (status <> 'draft' or app.can_manage_crew(app.document_org(document_id)));
create policy document_versions_update_managers on public.document_versions
  for update to authenticated using (app.can_manage_crew(app.document_org(document_id))) with check (app.can_manage_crew(app.document_org(document_id)));
grant update on public.document_versions to authenticated;

-- Signing for yourself: your own name, a job you hold, the check passed.
create policy document_acknowledgements_insert_self on public.document_acknowledgements
  for insert to authenticated
  with check (recorded_by = (select auth.uid()) and project_id is not null and app.can_ack_own_document(version_id, person_name, project_id));
create policy "document acknowledgement signatures writable by the signer" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'entry-photos' and (storage.foldername(name))[2] = 'document' and app.is_project_member(((storage.foldername(name))[1])::uuid));

create policy document_assignments_select on public.document_assignments for select to authenticated
  using (user_id = (select auth.uid()) or app.reads_org_record(app.version_org(version_id)));
create policy document_assignments_update_managers on public.document_assignments for update to authenticated
  using (app.can_manage_crew(app.version_org(version_id))) with check (app.can_manage_crew(app.version_org(version_id)));

create policy document_questions_select on public.document_questions for select to authenticated using (app.is_org_member(app.version_org(version_id)));
create policy document_questions_write_managers on public.document_questions for all to authenticated
  using (app.can_manage_crew(app.version_org(version_id))) with check (app.can_manage_crew(app.version_org(version_id)));

create policy document_quiz_attempts_select on public.document_quiz_attempts for select to authenticated
  using (user_id = (select auth.uid()) or app.can_manage_crew(app.version_org(version_id)));

create policy document_events_select on public.document_events for select to authenticated
  using (subject_id = (select auth.uid()) or app.can_manage_crew(app.document_org(document_id)));

grant select, update on public.document_assignments to authenticated;
-- The right answer is never selected by a signed-in account: the grader reads it, the key function hands it to managers.
grant select (id, version_id, position, prompt, options), insert, update (position, prompt, options, correct_index), delete on public.document_questions to authenticated;
grant select on public.document_quiz_attempts to authenticated;
grant select on public.document_events to authenticated;
grant all on public.document_assignments, public.document_questions, public.document_quiz_attempts, public.document_events to service_role;
