-- Forms engine (README R180): the company's checklists, designed once and versioned; filled on the phone, saved
-- as they go, frozen at completion; every failing answer on the non-compliance register, and the ones the form
-- says to raise are also actions in the R177 register (origin `form`). Nothing here is deleted: a template
-- retires, a submission is voided with a reason, a non-compliance is removed with a reason.

-- ---------------------------------------------------------------------------
-- 1. Templates — the form as the office wrote it. A revision is a new row; issued = frozen.
-- ---------------------------------------------------------------------------
create table public.form_templates (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organisations (id) on delete restrict,
  -- FRM-001… per company, issued by the DB on the original; a revision carries the same code.
  seq             integer not null,
  code            text not null,
  revision        text not null default 'A',
  supersedes_id   uuid references public.form_templates (id),
  title           text not null check (length(btrim(title)) > 0),
  category        text not null default 'safety'
                  check (category in ('safety', 'plant', 'vehicle', 'people', 'environment', 'quality', 'other')),
  status          text not null default 'draft' check (status in ('draft', 'issued', 'superseded', 'retired')),
  -- public: anyone in the audience starts it any time. scheduled: opened from a schedule (R181), may still be started by hand.
  profile         text not null default 'public' check (profile in ('public', 'scheduled')),
  -- Roles that may fill it; empty = every member of the job. The one way a form reaches a labourer.
  audience        text[] not null default '{}',
  -- What the form is about: nothing in particular, a machine from the register, or a person by name.
  subject         text not null default 'none' check (subject in ('none', 'plant', 'person')),
  spec            jsonb not null default '{"header": [], "sections": []}'::jsonb,
  pass_mark       integer check (pass_mark is null or pass_mark between 0 and 100),
  signature       text not null default 'required' check (signature in ('required', 'optional', 'none')),
  -- Why the form exists, in the words of what requires it: "Fatigue management procedure cl. 4".
  basis           text,
  -- A passed form OFFERS to record this ticket type on the person (never automatic).
  competency_key  text,
  issued_at       timestamptz,
  issued_by       uuid references auth.users (id),
  created_by      uuid references auth.users (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint form_templates_code_rev unique (org_id, code, revision),
  constraint form_templates_audience_roles check (audience <@ array['supervisor', 'leading_hand', 'labourer', 'pm', 'admin']::text[])
);
create index form_templates_org_idx on public.form_templates (org_id, status, title);

-- What is wrong with a form's spec, in words. Empty = it may issue. The TS twin is `templateProblems`; the DB wins.
create or replace function app.form_template_problems(p_spec jsonb)
returns text[] language plpgsql immutable set search_path = '' as $$
declare problems text[] := '{}';
declare sec jsonb; q jsonb; keys text[] := '{}'; k text; t text; n_q integer := 0; si integer := 0;
begin
  if jsonb_typeof(p_spec -> 'sections') <> 'array' then return array['The form has no sections.']; end if;
  if jsonb_typeof(coalesce(p_spec -> 'header', '[]'::jsonb)) <> 'array' then problems := problems || 'The header is not a list.'; end if;
  for sec in select * from jsonb_array_elements(p_spec -> 'sections') loop
    si := si + 1;
    if length(btrim(coalesce(sec ->> 'title', ''))) = 0 then problems := problems || format('Section %s has no title.', si); end if;
    if jsonb_typeof(sec -> 'questions') <> 'array' then problems := problems || format('Section %s has no questions.', si); continue; end if;
    for q in select * from jsonb_array_elements(sec -> 'questions') loop
      n_q := n_q + 1;
      k := q ->> 'key'; t := q ->> 'type';
      if k is null or k !~ '^[a-z0-9_]{1,40}$' then problems := problems || format('Question %s has no key.', n_q); continue; end if;
      if k = any(keys) then problems := problems || format('Question key "%s" is used twice.', k); end if;
      keys := keys || k;
      if length(btrim(coalesce(q ->> 'label', ''))) = 0 then problems := problems || format('Question "%s" has no wording.', k); end if;
      if t is null or t not in ('yes_no', 'ok_issue_na', 'pass_fail', 'score', 'number', 'select', 'multi', 'text', 'date', 'time', 'photo', 'person', 'plant', 'signature') then
        problems := problems || format('Question "%s" has an unknown type.', k);
      end if;
      if t = 'score' and (coalesce((q ->> 'max')::numeric, 5) < 1 or coalesce((q ->> 'max')::numeric, 5) > 100) then
        problems := problems || format('Question "%s": a score runs to between 1 and 100.', k);
      end if;
      if t = 'score' and coalesce((q ->> 'weight')::numeric, 1) <= 0 then problems := problems || format('Question "%s": the weight is above zero.', k); end if;
      if t in ('select', 'multi') and (jsonb_typeof(q -> 'options') <> 'array' or jsonb_array_length(q -> 'options') = 0) then
        problems := problems || format('Question "%s" has no options.', k);
      end if;
      if t = 'number' and (q ->> 'min') is not null and (q ->> 'max') is not null and (q ->> 'min')::numeric > (q ->> 'max')::numeric then
        problems := problems || format('Question "%s": the minimum is above the maximum.', k);
      end if;
      if t = 'yes_no' and (q ->> 'fail') is not null and (q ->> 'fail') not in ('yes', 'no') then
        problems := problems || format('Question "%s": the failing answer is yes or no.', k);
      end if;
    end loop;
  end loop;
  if n_q = 0 then problems := problems || 'The form has no questions.'; end if;
  return problems;
exception when others then
  return array['The form could not be read: ' || sqlerrm];
end; $$;

create or replace function app.next_revision(p_rev text)
returns text language sql immutable set search_path = '' as $$
  select case when p_rev ~ '^[A-Y]$' then chr(ascii(p_rev) + 1) else p_rev || 'A' end;
$$;

create or replace function app.form_templates_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare prev public.form_templates%rowtype; problems text[];
begin
  new.title := btrim(new.title);
  new.basis := nullif(btrim(coalesce(new.basis, '')), '');
  new.competency_key := nullif(btrim(coalesce(new.competency_key, '')), '');
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.status := 'draft'; new.issued_at := null; new.issued_by := null;
    if new.supersedes_id is not null then
      select * into prev from public.form_templates where id = new.supersedes_id;
      if prev.id is null or prev.org_id <> new.org_id then
        raise exception 'A revision follows a form of the same company.' using errcode = 'check_violation';
      end if;
      if prev.status <> 'issued' then
        raise exception 'Only an issued form takes a revision.' using errcode = 'check_violation';
      end if;
      new.seq := prev.seq; new.code := prev.code; new.revision := app.next_revision(prev.revision);
    else
      perform pg_advisory_xact_lock(hashtext('form_templates:' || new.org_id::text));
      select coalesce(max(seq), 0) + 1 into new.seq from public.form_templates where org_id = new.org_id;
      new.code := 'FRM-' || lpad(new.seq::text, 3, '0');
      new.revision := 'A';
    end if;
    return new;
  end if;
  if new.org_id <> old.org_id or new.seq <> old.seq or new.code <> old.code or new.revision <> old.revision
     or new.supersedes_id is distinct from old.supersedes_id or new.created_by is distinct from old.created_by or new.created_at <> old.created_at then
    raise exception 'A form keeps its code, revision and company.' using errcode = 'check_violation';
  end if;
  if old.status in ('superseded', 'retired') then
    raise exception 'A superseded or retired form is frozen.' using errcode = 'check_violation';
  end if;
  if old.status = 'issued' then
    -- Superseded only by the issue of its own next revision (the setting is put by the issuing branch below).
    if new.status = 'superseded' and current_setting('app.form_supersede', true) = old.id::text then
      return new;
    end if;
    if new.status = 'retired' and new.title = old.title and new.spec = old.spec and new.audience = old.audience and new.profile = old.profile
       and new.subject = old.subject and new.pass_mark is not distinct from old.pass_mark and new.signature = old.signature
       and new.category = old.category and new.basis is not distinct from old.basis and new.competency_key is not distinct from old.competency_key then
      return new;
    end if;
    raise exception 'An issued form is frozen; a change is a new revision.' using errcode = 'check_violation';
  end if;
  -- A draft: anything may change until it issues.
  new.issued_at := old.issued_at; new.issued_by := old.issued_by;
  if new.status = 'issued' then
    problems := app.form_template_problems(new.spec);
    if array_length(problems, 1) > 0 then
      raise exception 'The form cannot issue: %', array_to_string(problems, ' ') using errcode = 'check_violation';
    end if;
    new.issued_at := now(); new.issued_by := coalesce(auth.uid(), new.created_by);
    if new.supersedes_id is not null then
      perform set_config('app.form_supersede', new.supersedes_id::text, true);
      update public.form_templates set status = 'superseded' where id = new.supersedes_id and status = 'issued';
      perform set_config('app.form_supersede', '', true);
    end if;
  elsif new.status = 'superseded' then
    raise exception 'A form is superseded by issuing its next revision.' using errcode = 'check_violation';
  end if;
  return new;
end; $$;
create trigger a_form_templates_before_write before insert or update on public.form_templates
  for each row execute function app.form_templates_before_write();

create or replace function app.form_templates_before_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.status <> 'draft' then
    raise exception 'A form that was issued is retired, never removed.' using errcode = 'check_violation';
  end if;
  return old;
end; $$;
create trigger a_form_templates_before_delete before delete on public.form_templates
  for each row execute function app.form_templates_before_delete();

-- ---------------------------------------------------------------------------
-- 2. Who may fill a form: a member of the job whose role the audience names (empty = every member).
-- ---------------------------------------------------------------------------
create or replace function app.form_audience_ok(p_org uuid, p_audience text[])
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(array_length(p_audience, 1), 0) = 0
      or exists (
        select 1 from public.project_members pm join public.projects p on p.id = pm.project_id
         where p.org_id = p_org and pm.user_id = (select auth.uid()) and pm.role::text = any(p_audience));
$$;
grant execute on function app.form_audience_ok(uuid, text[]) to authenticated;

create or replace function app.can_fill_form(p_template uuid, p_project uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.form_templates t
      join public.projects p on p.id = p_project and p.org_id = t.org_id
      join public.project_members pm on pm.project_id = p.id and pm.user_id = (select auth.uid())
     where t.id = p_template and t.status = 'issued'
       and (coalesce(array_length(t.audience, 1), 0) = 0 or pm.role::text = any(t.audience)));
$$;
grant execute on function app.can_fill_form(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Submissions — one filled form. Born open and saved as it goes; frozen at completion.
-- ---------------------------------------------------------------------------
create table public.form_submissions (
  id                      uuid primary key,
  project_id              uuid not null references public.projects (id) on delete restrict,
  template_id             uuid not null references public.form_templates (id) on delete restrict,
  -- Copied from the template the moment the form starts; a reworded template never changes what was asked.
  template_code           text not null,
  template_title          text not null,
  revision                text not null,
  category                text not null,
  spec                    jsonb not null,
  pass_mark               integer,
  signature_rule          text not null,
  subject                 text not null,
  subject_plant_id        uuid references public.plant_register (id),
  subject_person          text,
  header                  jsonb not null default '{}'::jsonb,
  -- { [key]: { value, note?, photo_paths? } }
  answers                 jsonb not null default '{}'::jsonb,
  status                  text not null default 'open' check (status in ('open', 'completed', 'voided')),
  score                   numeric(5, 1),
  outcome                 text check (outcome is null or outcome in ('pass', 'fail')),
  started_by              uuid not null references auth.users (id),
  started_at              timestamptz not null default now(),
  completed_by            uuid references auth.users (id),
  completed_at            timestamptz,
  completed_on_device_at  timestamptz,
  signature_path          text,
  voided_at               timestamptz,
  voided_by               uuid references auth.users (id),
  void_reason             text,
  updated_at              timestamptz not null default now()
);
create index form_submissions_project_idx on public.form_submissions (project_id, status, completed_at desc);
create index form_submissions_template_idx on public.form_submissions (template_id);

-- Does this answer FAIL the question? Unanswered is not a fail (a required one blocks completion instead).
create or replace function app.form_answer_fails(p_q jsonb, p_a jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare t text := p_q ->> 'type'; v jsonb := p_a -> 'value'; s text;
begin
  if p_a is null or v is null or jsonb_typeof(v) = 'null' then return false; end if;
  s := case when jsonb_typeof(v) = 'string' then v #>> '{}' else v::text end;
  if t = 'yes_no' then return s = coalesce(p_q ->> 'fail', 'no');
  elsif t = 'ok_issue_na' then return s = 'issue';
  elsif t = 'pass_fail' then return s = 'fail';
  elsif t = 'score' then return (p_q ->> 'fail') is not null and s ~ '^-?[0-9]+(\.[0-9]+)?$' and s::numeric < (p_q ->> 'fail')::numeric;
  elsif t = 'number' then
    if s !~ '^-?[0-9]+(\.[0-9]+)?$' then return false; end if;
    return ((p_q ->> 'min') is not null and s::numeric < (p_q ->> 'min')::numeric)
        or ((p_q ->> 'max') is not null and s::numeric > (p_q ->> 'max')::numeric);
  elsif t = 'select' then
    return jsonb_typeof(p_q -> 'fail_options') = 'array' and (p_q -> 'fail_options') ? s;
  elsif t = 'multi' then
    return jsonb_typeof(p_q -> 'fail_options') = 'array' and jsonb_typeof(v) = 'array'
       and exists (select 1 from jsonb_array_elements_text(v) e where (p_q -> 'fail_options') ? e);
  end if;
  return false;
exception when others then
  return false;
end; $$;

-- Is this question answered at all?
create or replace function app.form_answered(p_q jsonb, p_a jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare t text := p_q ->> 'type'; v jsonb := p_a -> 'value';
begin
  if p_a is null then return false; end if;
  if t = 'photo' then return coalesce(jsonb_typeof(p_a -> 'photo_paths'), 'none') = 'array' and jsonb_array_length(p_a -> 'photo_paths') > 0; end if;
  if v is null or jsonb_typeof(v) = 'null' then return false; end if;
  if jsonb_typeof(v) = 'string' then return length(btrim(v #>> '{}')) > 0; end if;
  if jsonb_typeof(v) = 'array' then return jsonb_array_length(v) > 0; end if;
  return true;
end; $$;

-- The score as a percentage over the ANSWERED score questions, weighted; null when there are none.
create or replace function app.form_score(p_spec jsonb, p_answers jsonb)
returns numeric language plpgsql immutable set search_path = '' as $$
declare q jsonb; a jsonb; w numeric; mx numeric; v text; got numeric := 0; of numeric := 0;
begin
  for q in select qq from jsonb_array_elements(p_spec -> 'sections') s, jsonb_array_elements(s -> 'questions') qq loop
    if q ->> 'type' <> 'score' then continue; end if;
    a := p_answers -> (q ->> 'key');
    if not app.form_answered(q, a) then continue; end if;
    v := case when jsonb_typeof(a -> 'value') = 'string' then a #>> '{value}' else (a -> 'value')::text end;
    if v !~ '^-?[0-9]+(\.[0-9]+)?$' then continue; end if;
    w := coalesce((q ->> 'weight')::numeric, 1); mx := coalesce((q ->> 'max')::numeric, 5);
    if mx <= 0 then continue; end if;
    got := got + w * least(greatest(v::numeric, 0), mx) / mx; of := of + w;
  end loop;
  if of = 0 then return null; end if;
  return round(100 * got / of, 1);
exception when others then
  return null;
end; $$;

-- What stops a form completing, in words. Empty = it may complete. TS twin `completionProblems`; the DB wins.
create or replace function app.form_completion_problems(p_spec jsonb, p_answers jsonb)
returns text[] language plpgsql immutable set search_path = '' as $$
declare problems text[] := '{}'; q jsonb; a jsonb;
begin
  for q in select qq from jsonb_array_elements(p_spec -> 'sections') s, jsonb_array_elements(s -> 'questions') qq loop
    a := p_answers -> (q ->> 'key');
    if coalesce((q ->> 'required')::boolean, false) and not app.form_answered(q, a) then
      problems := problems || format('"%s" is not answered.', q ->> 'label');
    end if;
    if coalesce((q ->> 'photo_required')::boolean, false) and app.form_answer_fails(q, a)
       and (coalesce(jsonb_typeof(a -> 'photo_paths'), 'none') <> 'array' or jsonb_array_length(a -> 'photo_paths') = 0) then
      problems := problems || format('"%s" failed and needs a photograph.', q ->> 'label');
    end if;
  end loop;
  return problems;
exception when others then
  return array['The answers could not be read: ' || sqlerrm];
end; $$;

create or replace function app.form_submissions_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare t public.form_templates%rowtype; org uuid; problems text[]; any_fail boolean;
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
     or new.category <> old.category or new.pass_mark is distinct from old.pass_mark or new.signature_rule <> old.signature_rule or new.subject <> old.subject then
    raise exception 'A form keeps its job, its template and who started it.' using errcode = 'check_violation';
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
create trigger a_form_submissions_before_write before insert or update on public.form_submissions
  for each row execute function app.form_submissions_before_write();

create or replace function app.form_submissions_before_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.status <> 'open' then
    raise exception 'A completed form is part of the record; the office voids it with a reason.' using errcode = 'check_violation';
  end if;
  return old;
end; $$;
create trigger a_form_submissions_before_delete before delete on public.form_submissions
  for each row execute function app.form_submissions_before_delete();

-- ---------------------------------------------------------------------------
-- 4. Non-compliances — every failing answer, written by the database at completion. The ones the question
--    marked `raise_action` are also actions (origin `form` in the register).
-- ---------------------------------------------------------------------------
create table public.form_non_compliances (
  id                uuid primary key default gen_random_uuid(),
  submission_id     uuid not null references public.form_submissions (id) on delete restrict,
  project_id        uuid not null references public.projects (id) on delete restrict,
  question_key      text not null,
  question_label    text not null,
  answer            text,
  note              text,
  photo_paths       text[] not null default '{}',
  status            text not null default 'open' check (status in ('open', 'resolved', 'removed')),
  resolution        text,
  resolved_by       uuid references auth.users (id),
  resolved_at       timestamptz,
  removed_reason    text,
  removed_by        uuid references auth.users (id),
  removed_at        timestamptz,
  raised_as_action  boolean not null default false,
  action            text,
  priority          text not null default 'normal' check (priority in ('normal', 'high', 'critical')),
  owner_name        text,
  assigned_to       uuid references auth.users (id),
  due_on            date,
  done_at           timestamptz,
  done_by           uuid references auth.users (id),
  done_note         text,
  created_at        timestamptz not null default now(),
  constraint form_non_compliances_once unique (submission_id, question_key)
);
create index form_non_compliances_project_idx on public.form_non_compliances (project_id, status, due_on);

create or replace function app.form_submissions_after_complete()
returns trigger language plpgsql security definer set search_path = '' as $$
declare q jsonb; a jsonb; v text;
begin
  if new.status <> 'completed' or old.status = 'completed' then return null; end if;
  for q in select qq from jsonb_array_elements(new.spec -> 'sections') s, jsonb_array_elements(s -> 'questions') qq loop
    a := new.answers -> (q ->> 'key');
    if not app.form_answer_fails(q, a) then continue; end if;
    v := case when jsonb_typeof(a -> 'value') = 'string' then a #>> '{value}' when a -> 'value' is null then null else (a -> 'value')::text end;
    insert into public.form_non_compliances (submission_id, project_id, question_key, question_label, answer, note, photo_paths, raised_as_action, action)
    values (new.id, new.project_id, q ->> 'key', q ->> 'label', v, nullif(btrim(coalesce(a ->> 'note', '')), ''),
            coalesce((select array_agg(e) from jsonb_array_elements_text(case when jsonb_typeof(a -> 'photo_paths') = 'array' then a -> 'photo_paths' else '[]'::jsonb end) e), '{}'),
            coalesce((q ->> 'raise_action')::boolean, false),
            case when coalesce((q ->> 'raise_action')::boolean, false) then new.template_title || ': ' || (q ->> 'label') else null end);
  end loop;
  return null;
end; $$;
create trigger b_form_submissions_after_complete after update on public.form_submissions
  for each row execute function app.form_submissions_after_complete();

create or replace function app.form_non_compliances_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare org uuid;
begin
  new.action := nullif(btrim(coalesce(new.action, '')), '');
  new.owner_name := nullif(btrim(coalesce(new.owner_name, '')), '');
  if tg_op = 'INSERT' then
    -- Only the completion trigger inserts; it runs as the definer, and the policies give nobody else an insert.
    new.status := 'open'; new.resolution := null; new.resolved_by := null; new.resolved_at := null;
    new.removed_reason := null; new.removed_by := null; new.removed_at := null;
    new.done_at := null; new.done_by := null; new.done_note := null;
    return new;
  end if;
  if new.submission_id <> old.submission_id or new.project_id <> old.project_id or new.question_key <> old.question_key
     or new.question_label <> old.question_label or new.created_at <> old.created_at
     or new.photo_paths <> old.photo_paths or new.note is distinct from old.note or new.answer is distinct from old.answer then
    raise exception 'A non-compliance keeps what was answered.' using errcode = 'check_violation';
  end if;
  if old.status <> 'open' then
    raise exception 'A resolved or removed non-compliance is frozen.' using errcode = 'check_violation';
  end if;
  if old.raised_as_action and not new.raised_as_action then
    raise exception 'An action raised from a form stays raised.' using errcode = 'check_violation';
  end if;
  if new.raised_as_action and new.action is null then
    raise exception 'Say what has to be done.' using errcode = 'check_violation';
  end if;
  select org_id into org from public.projects where id = new.project_id;
  if not app.action_assignee_ok(org, new.project_id, new.assigned_to) then
    raise exception 'The assignee is someone on the job.' using errcode = 'check_violation';
  end if;
  -- Done (the action register's word) and resolved (this register's) are one event.
  if new.status = 'resolved' or (new.done_at is not null and old.done_at is null) then
    new.resolution := coalesce(nullif(btrim(coalesce(new.resolution, '')), ''), nullif(btrim(coalesce(new.done_note, '')), ''));
    if new.resolution is null then
      raise exception 'Say how it was resolved.' using errcode = 'check_violation';
    end if;
    new.status := 'resolved'; new.resolved_at := now(); new.resolved_by := coalesce(auth.uid(), new.resolved_by);
    new.done_at := case when new.raised_as_action then new.resolved_at else null end;
    new.done_by := case when new.raised_as_action then new.resolved_by else null end;
    new.done_note := case when new.raised_as_action then new.resolution else null end;
    return new;
  end if;
  if new.status = 'removed' then
    if length(btrim(coalesce(new.removed_reason, ''))) = 0 then
      raise exception 'Say why the non-compliance is removed.' using errcode = 'check_violation';
    end if;
    if not app.is_org_office(org) then
      raise exception 'Only the office removes a non-compliance.' using errcode = 'check_violation';
    end if;
    new.removed_at := now(); new.removed_by := coalesce(auth.uid(), new.removed_by);
    return new;
  end if;
  new.resolution := null; new.resolved_by := null; new.resolved_at := null; new.removed_reason := null; new.removed_by := null; new.removed_at := null;
  new.done_at := null; new.done_by := null; new.done_note := null;
  return new;
end; $$;
create trigger a_form_non_compliances_before_write before insert or update on public.form_non_compliances
  for each row execute function app.form_non_compliances_before_write();

create or replace function app.form_non_compliances_before_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'A non-compliance is resolved or removed with a reason, never deleted.' using errcode = 'check_violation';
end; $$;
create trigger a_form_non_compliances_before_delete before delete on public.form_non_compliances
  for each row execute function app.form_non_compliances_before_delete();

-- ---------------------------------------------------------------------------
-- 5. The action register gains origin `form`.
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
   where n.raised_as_action and n.status <> 'removed' and s.status = 'completed';

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
-- 6. Access. Templates: the company reads (a labourer only an issued form that names their role); the office writes.
--    Submissions: the record, plus the person's own. Non-compliances: the record, plus those on the person's own forms.
-- ---------------------------------------------------------------------------
alter table public.form_templates enable row level security;
alter table public.form_submissions enable row level security;
alter table public.form_non_compliances enable row level security;

create policy form_templates_select on public.form_templates
  for select to authenticated
  using (app.is_org_member(org_id) and (app.reads_org_record(org_id) or (status = 'issued' and app.form_audience_ok(org_id, audience))));
create policy form_templates_write_office on public.form_templates
  for all to authenticated using (app.is_org_office(org_id)) with check (app.is_org_office(org_id));

create policy form_submissions_select on public.form_submissions
  for select to authenticated
  using (app.is_project_member(project_id) and (app.reads_record(project_id) or started_by = (select auth.uid())));
create policy form_submissions_insert on public.form_submissions
  for insert to authenticated
  with check (started_by = (select auth.uid()) and app.can_fill_form(template_id, project_id));
create policy form_submissions_update on public.form_submissions
  for update to authenticated
  using (app.is_project_member(project_id) and (started_by = (select auth.uid()) or app.can_run_talks(project_id) or app.is_org_office((select org_id from public.projects where id = project_id))))
  with check (app.is_project_member(project_id));
create policy form_submissions_delete_own_open on public.form_submissions
  for delete to authenticated
  using (started_by = (select auth.uid()) and status = 'open');

create policy form_non_compliances_select on public.form_non_compliances
  for select to authenticated
  using (app.is_project_member(project_id) and (app.reads_record(project_id)
         or exists (select 1 from public.form_submissions s where s.id = submission_id and s.started_by = (select auth.uid()))));
create policy form_non_compliances_update_crew on public.form_non_compliances
  for update to authenticated
  using (app.can_run_talks(project_id)) with check (app.can_run_talks(project_id));

grant select, insert, update, delete on public.form_templates to authenticated;
grant select, insert, update, delete on public.form_submissions to authenticated;
grant select, update on public.form_non_compliances to authenticated;
grant all on public.form_templates, public.form_submissions, public.form_non_compliances to service_role;

-- Files: {project}/form/{submission}/… in entry-photos — written by whoever may write the submission, read by
-- whoever may read it (the labourer their own; README R75's shape).
create or replace function app.form_file_writable(p_name text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare folder text[] := storage.foldername(p_name); sub uuid; proj uuid;
begin
  if folder[2] <> 'form' then return false; end if;
  begin sub := folder[3]::uuid; proj := folder[1]::uuid; exception when others then return false; end;
  return exists (select 1 from public.form_submissions s
                  where s.id = sub and s.project_id = proj and s.status = 'open'
                    and (s.started_by = (select auth.uid()) or app.can_run_talks(s.project_id)));
end; $$;
grant execute on function app.form_file_writable(text) to authenticated;

create or replace function app.form_photo_readable(p_name text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare folder text[] := storage.foldername(p_name); sub uuid;
begin
  if app.reads_record(app.storage_project_id(p_name)) then return true; end if;
  begin sub := folder[3]::uuid; exception when others then return false; end;
  return exists (select 1 from public.form_submissions s where s.id = sub and s.started_by = (select auth.uid()));
end; $$;
grant execute on function app.form_photo_readable(text) to authenticated;

create policy "form files writable by the filler" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'entry-photos' and app.form_file_writable(name));

drop policy if exists "record media reads by role" on storage.objects;
create policy "record media reads by role" on storage.objects
  as restrictive
  for select to authenticated
  using (
    case
      when bucket_id in ('entry-audio', 'exports')
        then app.reads_record(app.storage_project_id(name))
      when bucket_id = 'entry-photos'
        then case
               when (storage.foldername(name))[2] = 'incident' then app.incident_photo_readable(name)
               when (storage.foldername(name))[2] = 'form' then app.form_photo_readable(name)
               else app.reads_record(app.storage_project_id(name))
             end
      else true
    end
  );
