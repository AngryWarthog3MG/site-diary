-- ============================================================================
-- The QA engine (README R96): ITPs, ITRs and site-pack forms from templates.
--
-- One template shape renders every form. A template is company data, kept by
-- the office, versioned: a revision is edited until it is issued, then frozen;
-- a change is a new revision. An ITP is instanced once per job (approval by
-- the head contractor, then signed); an ITR or site form is a RECORD, made
-- many times, one per element or lot, with a client-chosen id so the phone can
-- write it with no signal and upsert it later exactly once.
--
-- A record is never blocked: a gap is an answer. It is frozen by trigger once
-- every required party has signed, like a signed dayworks docket; voided with
-- a reason, never deleted. A hold point form is released only when every party
-- marked is_release has signed — the DB stamps released_at.
--
-- Photos and signatures live in bucket entry-photos under {project}/qa/{record}/.
-- The record tables sit behind the labourer read lock. Nothing here carries
-- money, rates or contract flags.
-- ============================================================================

create table public.qa_templates (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organisations (id) on delete restrict,
  code          text not null check (code ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{1,40}$'),
  revision      text not null check (length(btrim(revision)) between 1 and 8),
  kind          text not null check (kind in ('itp', 'itr_checklist', 'itr_register', 'site_form')),
  title         text not null check (length(btrim(title)) > 0),
  governing_itp text,
  modules       text[] not null default '{}',
  spec          jsonb not null,
  issued_at     timestamptz,
  issued_by     uuid references auth.users (id),
  retired_at    timestamptz,
  created_by    uuid references auth.users (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (org_id, code, revision)
);
comment on table public.qa_templates is 'One row per revision of an ITP, ITR or site form. spec is the whole template (README R96); edited until issued, then frozen. Company data.';

-- What is wrong with a template — the SQL twin of templateProblems in src/lib/qa/model.ts. The DB wins.
create or replace function app.qa_template_problems(p_spec jsonb)
returns text[] language plpgsql immutable set search_path = '' as $$
declare
  out_ text[] := '{}';
  kind text := p_spec->>'kind';
  s jsonb; it jsonb; a jsonb; c jsonb; party text; mark text;
  ids text[] := '{}'; keys text[] := '{}'; parties text[];
begin
  if length(btrim(coalesce(p_spec->>'code', ''))) = 0 then out_ := out_ || 'a code'; end if;
  if kind is null or kind not in ('itp', 'itr_checklist', 'itr_register', 'site_form') then out_ := out_ || 'a kind (itp, itr_checklist, itr_register or site_form)'; end if;
  if length(btrim(coalesce(p_spec->>'title', ''))) = 0 then out_ := out_ || 'a title'; end if;
  if length(btrim(coalesce(p_spec->>'revision', ''))) = 0 then out_ := out_ || 'a revision'; end if;
  if jsonb_typeof(p_spec->'signoffs') = 'array' then
    for s in select * from jsonb_array_elements(p_spec->'signoffs') loop
      if length(btrim(coalesce(s->>'party', ''))) = 0 then out_ := out_ || 'every sign-off needs a party'; end if;
      if coalesce((s->>'is_release')::boolean, false) and not coalesce((p_spec->>'hold_point')::boolean, false) then
        out_ := out_ || 'a release sign-off only on a hold point form';
      end if;
    end loop;
  end if;
  if kind = 'itp' then
    parties := array(select jsonb_array_elements_text(coalesce(p_spec->'parties', '[]'::jsonb)));
    if coalesce(array_length(parties, 1), 0) = 0 then out_ := out_ || 'the inspecting parties'; end if;
    if jsonb_typeof(p_spec->'activities') <> 'array' or jsonb_array_length(p_spec->'activities') = 0 then out_ := out_ || 'at least one activity'; end if;
    for a in select * from jsonb_array_elements(coalesce(p_spec->'activities', '[]'::jsonb)) loop
      if length(btrim(coalesce(a->>'no', ''))) = 0 or length(btrim(coalesce(a->>'activity', ''))) = 0 then out_ := out_ || 'every activity numbered and named'; end if;
      if (a->>'no') = any(ids) then out_ := out_ || format('activity %s twice', a->>'no'); end if;
      ids := ids || (a->>'no');
      for party, mark in select key, value from jsonb_each_text(coalesce(a->'inspection', '{}'::jsonb)) loop
        if not (party = any(parties)) then out_ := out_ || format('activity %s inspects for an unknown party (%s)', a->>'no', party); end if;
        if mark <> '' and mark !~ '^(H|W|R)(,\s*(H|W|R))*$' then out_ := out_ || format('activity %s: inspection type %s is not H, W or R', a->>'no', mark); end if;
      end loop;
    end loop;
  elsif kind = 'itr_register' then
    if jsonb_typeof(p_spec->'columns') <> 'array' or jsonb_array_length(p_spec->'columns') = 0 then out_ := out_ || 'at least one column'; end if;
    for c in select * from jsonb_array_elements(coalesce(p_spec->'columns', '[]'::jsonb)) loop
      if length(btrim(coalesce(c->>'key', ''))) = 0 or length(btrim(coalesce(c->>'label', ''))) = 0 then out_ := out_ || 'every column keyed and labelled'; end if;
      if (c->>'key') = any(keys) then out_ := out_ || format('column %s twice', c->>'key'); end if;
      keys := keys || (c->>'key');
    end loop;
  elsif kind in ('itr_checklist', 'site_form') then
    if not exists (select 1 from jsonb_array_elements(coalesce(p_spec->'sections', '[]'::jsonb)) sec, jsonb_array_elements(coalesce(sec->'items', '[]'::jsonb))) then
      out_ := out_ || 'at least one item';
    end if;
    for it in select i from jsonb_array_elements(coalesce(p_spec->'sections', '[]'::jsonb)) sec, jsonb_array_elements(coalesce(sec->'items', '[]'::jsonb)) i loop
      if length(btrim(coalesce(it->>'id', ''))) = 0 or length(btrim(coalesce(it->>'text', ''))) = 0 then out_ := out_ || 'every item numbered and worded'; end if;
      if (it->>'id') = any(ids) then out_ := out_ || format('item %s twice', it->>'id'); end if;
      ids := ids || (it->>'id');
      if it ? 'value_type' and (it->>'value_type') not in ('none', 'text', 'number', 'ref', 'photo') then out_ := out_ || format('item %s: value type %s', it->>'id', it->>'value_type'); end if;
    end loop;
  end if;
  keys := '{}';
  for c in select * from jsonb_array_elements(coalesce(p_spec->'header_fields', '[]'::jsonb)) loop
    if length(btrim(coalesce(c->>'key', ''))) = 0 or length(btrim(coalesce(c->>'label', ''))) = 0 then out_ := out_ || 'every header field keyed and labelled'; end if;
    if (c->>'key') = any(keys) then out_ := out_ || format('header field %s twice', c->>'key'); end if;
    keys := keys || (c->>'key');
  end loop;
  return array(select distinct unnest(out_));
end; $$;

create or replace function app.qa_templates_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare probs text[];
begin
  -- The spec is the truth; the columns are read off it so a listing never disagrees with the form.
  new.code := btrim(coalesce(new.spec->>'code', new.code));
  new.revision := upper(btrim(coalesce(new.spec->>'revision', new.revision)));
  new.kind := coalesce(new.spec->>'kind', new.kind);
  new.title := regexp_replace(btrim(coalesce(new.spec->>'title', new.title)), '\s+', ' ', 'g');
  new.governing_itp := nullif(btrim(coalesce(new.spec->>'governing_itp', new.governing_itp, '')), '');
  if jsonb_typeof(new.spec->'modules') = 'array' then new.modules := array(select jsonb_array_elements_text(new.spec->'modules')); end if;
  probs := app.qa_template_problems(new.spec);
  if coalesce(array_length(probs, 1), 0) > 0 then
    raise exception 'The template still needs: %.', array_to_string(probs, '; ') using errcode = 'check_violation';
  end if;
  if tg_op = 'INSERT' then
    new.created_by := coalesce((select auth.uid()), new.created_by);
    new.created_at := now();
    new.retired_at := null;
    if new.issued_at is not null then new.issued_by := coalesce((select auth.uid()), new.issued_by); end if;
  else
    if new.org_id <> old.org_id or new.created_by is distinct from old.created_by or new.created_at <> old.created_at then
      raise exception 'A template stays with its company.' using errcode = 'check_violation';
    end if;
    if old.issued_at is not null then
      -- Issued: frozen. Retiring is the one change; the next wording is the next revision.
      if new.spec <> old.spec or new.issued_at is distinct from old.issued_at or new.issued_by is distinct from old.issued_by then
        raise exception 'Revision % of % is issued and frozen: make the change a new revision.', old.revision, old.code using errcode = 'check_violation';
      end if;
    elsif new.issued_at is not null then
      new.issued_by := coalesce((select auth.uid()), new.issued_by);
    end if;
  end if;
  new.updated_at := now();
  return new;
end; $$;
create trigger a_qa_templates_before_write before insert or update on public.qa_templates for each row execute function app.qa_templates_before_write();
create trigger a_qa_templates_no_delete before delete on public.qa_templates for each row execute function app.frozen_row();

-- ---------------------------------------------------------------------------
create table public.qa_itp_instances (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid not null references public.projects (id) on delete cascade,
  template_id        uuid not null references public.qa_templates (id),
  status             text not null default 'draft' check (status in ('draft', 'issued', 'approved', 'signed')),
  issued_to          text,
  issued_at          timestamptz,
  approved_by_name   text,
  approved_at        timestamptz,
  approval_file_path text,
  signed_at          timestamptz,
  created_by         uuid references auth.users (id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  voided_at          timestamptz,
  void_reason        text,
  constraint qa_itp_instances_void_reason check (voided_at is null or length(btrim(coalesce(void_reason, ''))) > 0)
);
create unique index qa_itp_instances_one_live_idx on public.qa_itp_instances (project_id, template_id) where voided_at is null;
comment on table public.qa_itp_instances is 'One ITP revision on one job: issued to the head contractor, approved (who, when, the countersigned file), signed at the end. Forward only; signed = frozen; voided never deleted.';

create or replace function app.qa_itp_instances_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare t record; v_org uuid; rank_old int; rank_new int;
begin
  select org_id into v_org from public.projects where id = new.project_id;
  select * into t from public.qa_templates where id = new.template_id;
  if t.id is null or t.org_id <> v_org then raise exception 'The ITP must be one of this company''s templates.' using errcode = 'check_violation'; end if;
  if t.kind <> 'itp' then raise exception 'Only an ITP is instanced on a job; an ITR is recorded.' using errcode = 'check_violation'; end if;
  if t.issued_at is null then raise exception 'Revision % of % is not issued yet.', t.revision, t.code using errcode = 'check_violation'; end if;
  new.issued_to := nullif(btrim(coalesce(new.issued_to, '')), '');
  new.approved_by_name := nullif(regexp_replace(btrim(coalesce(new.approved_by_name, '')), '\s+', ' ', 'g'), '');
  if new.status in ('approved', 'signed') and (new.approved_by_name is null or new.approved_at is null) then
    raise exception 'Approval names who approved the ITP and when.' using errcode = 'check_violation';
  end if;
  if new.approval_file_path is not null and split_part(new.approval_file_path, '/', 1) <> new.project_id::text then
    raise exception 'The countersigned ITP sits in its own job''s folder.' using errcode = 'check_violation';
  end if;
  if tg_op = 'INSERT' then
    new.created_by := coalesce((select auth.uid()), new.created_by); new.created_at := now();
    new.voided_at := null; new.void_reason := null;
    if new.status = 'issued' and new.issued_at is null then new.issued_at := now(); end if;
  else
    if new.project_id <> old.project_id or new.template_id <> old.template_id or new.created_by is distinct from old.created_by or new.created_at <> old.created_at then
      raise exception 'An ITP instance stays on its job and its revision.' using errcode = 'check_violation';
    end if;
    if old.voided_at is not null then raise exception 'This ITP instance is voided.' using errcode = 'check_violation'; end if;
    if new.voided_at is not null then
      -- Voiding: nothing else changes.
      if new.status <> old.status or new.approved_by_name is distinct from old.approved_by_name or new.approved_at is distinct from old.approved_at
         or new.approval_file_path is distinct from old.approval_file_path or new.signed_at is distinct from old.signed_at or new.issued_at is distinct from old.issued_at then
        raise exception 'Void it as it stands; nothing else changes with a void.' using errcode = 'check_violation';
      end if;
      new.voided_at := now(); new.void_reason := btrim(new.void_reason);
    else
      rank_old := array_position(array['draft', 'issued', 'approved', 'signed'], old.status);
      rank_new := array_position(array['draft', 'issued', 'approved', 'signed'], new.status);
      if rank_new < rank_old then raise exception 'An ITP moves forward: draft, issued, approved, signed.' using errcode = 'check_violation'; end if;
      if old.status = 'signed' then raise exception 'A signed ITP is frozen; void it and raise a new one.' using errcode = 'check_violation'; end if;
      if new.status = 'issued' and old.status = 'draft' and new.issued_at is null then new.issued_at := now(); end if;
      if new.status = 'signed' and new.signed_at is null then new.signed_at := now(); end if;
    end if;
  end if;
  new.updated_at := now();
  return new;
end; $$;
create trigger a_qa_itp_instances_before_write before insert or update on public.qa_itp_instances for each row execute function app.qa_itp_instances_before_write();
create trigger a_qa_itp_instances_no_delete before delete on public.qa_itp_instances for each row execute function app.frozen_row();

-- ---------------------------------------------------------------------------
create table public.qa_records (
  id                uuid primary key,
  project_id        uuid not null references public.projects (id) on delete cascade,
  template_id       uuid not null references public.qa_templates (id),
  itp_instance_id   uuid references public.qa_itp_instances (id),
  activity_no       text,
  lot_or_element    text,
  header            jsonb not null default '{}'::jsonb,
  items             jsonb not null default '[]'::jsonb,
  rows              jsonb not null default '[]'::jsonb,
  comments          text,
  signoffs          jsonb not null default '[]'::jsonb,
  gap_count         integer not null default 0,
  submitted_at      timestamptz,
  completed_at      timestamptz,
  released_at       timestamptz,
  client_created_at timestamptz not null default now(),
  created_by        uuid references auth.users (id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  voided_at         timestamptz,
  void_reason       text,
  diary_entry_id    uuid references public.entries (id),
  constraint qa_records_void_reason check (voided_at is null or length(btrim(coalesce(void_reason, ''))) > 0)
);
create index qa_records_job_idx on public.qa_records (project_id, template_id, completed_at, released_at, gap_count);
comment on table public.qa_records is 'One completed ITR or site form: header, item results (ok | na | gap), register rows, sign-offs. Client-chosen id, upserted; frozen once every required party has signed; voided never deleted. README R96.';

-- Who writes the record: the crew that runs the job, and the office.
create or replace function app.can_write_qa(p_project uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.project_members pm
     where pm.project_id = p_project and pm.user_id = (select auth.uid()) and pm.role::text in ('supervisor', 'leading_hand', 'pm', 'admin')
  );
$$;
grant execute on function app.can_write_qa(uuid) to authenticated;

create or replace function app.qa_records_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  t record; v_org uuid; inst record;
  item jsonb; so jsonb; oldso jsonb; rw jsonb; k text;
  item_ids text[]; col_keys text[]; hdr_keys text[]; parties text[]; required text[]; releasers text[]; signed_parties text[] := '{}';
  folder text; gaps integer := 0; all_required boolean; all_release boolean;
begin
  select org_id into v_org from public.projects where id = new.project_id;
  select * into t from public.qa_templates where id = new.template_id;
  if t.id is null or t.org_id <> v_org then raise exception 'The form must be one of this company''s templates.' using errcode = 'check_violation'; end if;
  if t.kind = 'itp' then raise exception 'An ITP is instanced on the job, not recorded; record against its ITRs.' using errcode = 'check_violation'; end if;
  if t.issued_at is null then raise exception 'Revision % of % is not issued yet.', t.revision, t.code using errcode = 'check_violation'; end if;
  if new.itp_instance_id is not null then
    select * into inst from public.qa_itp_instances where id = new.itp_instance_id;
    if inst.id is null or inst.project_id <> new.project_id then raise exception 'The ITP instance must be on this job.' using errcode = 'check_violation'; end if;
  end if;
  folder := new.project_id::text || '/qa/' || new.id::text || '/';
  new.lot_or_element := nullif(regexp_replace(btrim(coalesce(new.lot_or_element, '')), '\s+', ' ', 'g'), '');
  new.activity_no := nullif(btrim(coalesce(new.activity_no, '')), '');
  new.comments := nullif(btrim(coalesce(new.comments, '')), '');

  -- Header: only the keys the template names (when it names any).
  if jsonb_typeof(new.header) <> 'object' then raise exception 'header is an object.' using errcode = 'check_violation'; end if;
  hdr_keys := array(select x->>'key' from jsonb_array_elements(coalesce(t.spec->'header_fields', '[]'::jsonb)) x);
  if coalesce(array_length(hdr_keys, 1), 0) > 0 then
    for k in select jsonb_object_keys(new.header) loop
      if not (k = any(hdr_keys)) then raise exception 'Header field % is not on this form.', k using errcode = 'check_violation'; end if;
    end loop;
  end if;

  -- Items: each names an item of the form, with a state; photos sit in the record's own folder.
  if jsonb_typeof(new.items) <> 'array' then raise exception 'items is an array.' using errcode = 'check_violation'; end if;
  item_ids := array(select i->>'id' from jsonb_array_elements(coalesce(t.spec->'sections', '[]'::jsonb)) sec, jsonb_array_elements(coalesce(sec->'items', '[]'::jsonb)) i);
  for item in select * from jsonb_array_elements(new.items) loop
    if t.kind in ('itr_checklist', 'site_form') and not ((item->>'item_id') = any(item_ids)) then
      raise exception 'Item % is not on this form.', coalesce(item->>'item_id', '?') using errcode = 'check_violation';
    end if;
    if coalesce(item->>'state', '') not in ('ok', 'na', 'gap') then raise exception 'Item % needs a state: ok, na or gap.', item->>'item_id' using errcode = 'check_violation'; end if;
    if item->>'state' = 'gap' then gaps := gaps + 1; end if;
    if item ? 'photo_paths' then
      if jsonb_typeof(item->'photo_paths') <> 'array' then raise exception 'photo_paths is an array.' using errcode = 'check_violation'; end if;
      for k in select jsonb_array_elements_text(item->'photo_paths') loop
        if position(folder in k) <> 1 then raise exception 'A photo sits in the record''s own folder (%).', folder using errcode = 'check_violation'; end if;
      end loop;
    end if;
  end loop;
  new.gap_count := gaps;

  -- Register rows: only the columns the form has (a checklist's sub-register counts).
  if jsonb_typeof(new.rows) <> 'array' then raise exception 'rows is an array.' using errcode = 'check_violation'; end if;
  col_keys := array(select c->>'key' from jsonb_array_elements(coalesce(t.spec->'columns', '[]'::jsonb) || coalesce(t.spec->'sub_register'->'columns', '[]'::jsonb)) c);
  for rw in select * from jsonb_array_elements(new.rows) loop
    if jsonb_typeof(rw) <> 'object' then raise exception 'Each register row is an object.' using errcode = 'check_violation'; end if;
    for k in select jsonb_object_keys(rw) loop
      if not (k = any(col_keys)) then raise exception 'Column % is not on this register.', k using errcode = 'check_violation'; end if;
    end loop;
  end loop;

  -- Sign-offs: a party of the form, a name, a signature in the folder, a time; once made, never changed or removed.
  if jsonb_typeof(new.signoffs) <> 'array' then raise exception 'signoffs is an array.' using errcode = 'check_violation'; end if;
  parties := array(select s->>'party' from jsonb_array_elements(coalesce(t.spec->'signoffs', '[]'::jsonb)) s);
  required := array(select s->>'party' from jsonb_array_elements(coalesce(t.spec->'signoffs', '[]'::jsonb)) s where coalesce((s->>'required')::boolean, false));
  releasers := array(select s->>'party' from jsonb_array_elements(coalesce(t.spec->'signoffs', '[]'::jsonb)) s where coalesce((s->>'is_release')::boolean, false));
  for so in select * from jsonb_array_elements(new.signoffs) loop
    if not ((so->>'party') = any(parties)) then raise exception 'Sign-off party % is not on this form.', coalesce(so->>'party', '?') using errcode = 'check_violation'; end if;
    if length(btrim(coalesce(so->>'signer_name', ''))) = 0 then raise exception 'A sign-off names the signer.' using errcode = 'check_violation'; end if;
    if position(folder in coalesce(so->>'signature_path', '')) <> 1 then raise exception 'A signature sits in the record''s own folder.' using errcode = 'check_violation'; end if;
    if (so->>'signed_at') is null then raise exception 'A sign-off carries its time.' using errcode = 'check_violation'; end if;
    if (so->>'party') = any(signed_parties) then raise exception 'Party % signed twice.', so->>'party' using errcode = 'check_violation'; end if;
    signed_parties := signed_parties || (so->>'party');
  end loop;
  if tg_op = 'UPDATE' then
    for oldso in select * from jsonb_array_elements(old.signoffs) loop
      if not (new.signoffs @> jsonb_build_array(oldso)) then raise exception 'A sign-off once made is never changed or removed.' using errcode = 'check_violation'; end if;
    end loop;
  end if;
  all_required := coalesce(array_length(required, 1), 0) > 0 and required <@ signed_parties;
  all_release := coalesce(array_length(releasers, 1), 0) > 0 and releasers <@ signed_parties and coalesce((t.spec->>'hold_point')::boolean, false);

  if tg_op = 'INSERT' then
    new.created_by := coalesce((select auth.uid()), new.created_by);
    new.created_at := now();
    new.voided_at := null; new.void_reason := null;
    new.completed_at := case when all_required then now() end;
    new.released_at := case when all_release then now() end;
  else
    if new.project_id <> old.project_id or new.template_id <> old.template_id or new.created_by is distinct from old.created_by
       or new.created_at <> old.created_at or new.client_created_at <> old.client_created_at then
      raise exception 'A record stays on its job, its form and its author.' using errcode = 'check_violation';
    end if;
    if old.voided_at is not null then raise exception 'This record is voided.' using errcode = 'check_violation'; end if;
    if new.voided_at is not null then
      -- Voiding, at any stage: nothing else changes with it.
      if new.header <> old.header or new.items <> old.items or new.rows <> old.rows or new.signoffs <> old.signoffs
         or new.comments is distinct from old.comments or new.lot_or_element is distinct from old.lot_or_element
         or new.activity_no is distinct from old.activity_no or new.itp_instance_id is distinct from old.itp_instance_id
         or new.diary_entry_id is distinct from old.diary_entry_id or new.submitted_at is distinct from old.submitted_at then
        raise exception 'Void it as it stands; nothing else changes with a void.' using errcode = 'check_violation';
      end if;
      new.voided_at := now(); new.void_reason := btrim(new.void_reason);
      new.completed_at := old.completed_at; new.released_at := old.released_at; new.gap_count := old.gap_count;
    else
      if old.completed_at is not null then
        raise exception 'A signed record is frozen; void it and raise a new one.' using errcode = 'check_violation';
      end if;
      new.completed_at := case when all_required then now() end;
      new.released_at := coalesce(old.released_at, case when all_release then now() end);
    end if;
  end if;
  new.updated_at := now();
  return new;
end; $$;
create trigger a_qa_records_before_write before insert or update on public.qa_records for each row execute function app.qa_records_before_write();
create trigger a_qa_records_no_delete before delete on public.qa_records for each row execute function app.frozen_row();

-- ---------------------------------------------------------------------------
-- Access. Templates: the company reads, the office writes. Instances: the job reads, the office writes.
-- Records: the job reads, the crew and the office write. The labourer lock applies to instances and records.
alter table public.qa_templates enable row level security;
alter table public.qa_itp_instances enable row level security;
alter table public.qa_records enable row level security;
create policy qa_templates_select on public.qa_templates for select to authenticated using (app.is_org_member(org_id));
create policy qa_templates_insert on public.qa_templates for insert to authenticated with check (app.is_org_office(org_id));
create policy qa_templates_update on public.qa_templates for update to authenticated using (app.is_org_office(org_id)) with check (app.is_org_office(org_id));
create policy qa_itp_instances_select on public.qa_itp_instances for select to authenticated using (app.is_project_member(project_id));
create policy qa_itp_instances_reads_record on public.qa_itp_instances as restrictive for select to authenticated using (app.reads_record(project_id));
create policy qa_itp_instances_insert on public.qa_itp_instances for insert to authenticated with check (app.is_office(project_id));
create policy qa_itp_instances_update on public.qa_itp_instances for update to authenticated using (app.is_office(project_id)) with check (app.is_office(project_id));
create policy qa_records_select on public.qa_records for select to authenticated using (app.is_project_member(project_id));
create policy qa_records_reads_record on public.qa_records as restrictive for select to authenticated using (app.reads_record(project_id));
create policy qa_records_insert on public.qa_records for insert to authenticated with check (app.can_write_qa(project_id));
create policy qa_records_update on public.qa_records for update to authenticated using (app.can_write_qa(project_id)) with check (app.can_write_qa(project_id));
grant select, insert, update on public.qa_templates, public.qa_itp_instances, public.qa_records to authenticated;
grant all on public.qa_templates, public.qa_itp_instances, public.qa_records to service_role;

-- Photos, signatures and the countersigned ITP: {project}/qa/{record or itp/instance}/{file}, in the record media bucket,
-- written by the crew and the office; read by the job's members under the record-media policy already on the bucket.
create policy "qa files writable by crew" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'entry-photos'
    and (storage.foldername(name))[2] = 'qa'
    and app.can_write_qa(((storage.foldername(name))[1])::uuid)
  );
