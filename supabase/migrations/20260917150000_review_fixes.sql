-- ============================================================================
-- Second-agent review of environment (R73), subcontractor (R74) and older
-- register code — README R78.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Environment
-- ---------------------------------------------------------------------------

-- A company-wide evaluation covers the company-wide obligations; a job's evaluation covers those and
-- the job's own. A company evaluation counting every job's contract obligations could never be issued
-- by someone not on every job — the screen could not even show them.
create or replace function app.compliance_scope_missing(p_evaluation uuid)
returns integer language sql stable security definer set search_path = '' as $$
  select count(*)::integer
    from public.compliance_evaluations e
    join public.env_legal_obligations o on o.org_id = e.org_id and o.active
     and (o.project_id is null or o.project_id = e.project_id)
   where e.id = p_evaluation
     and not exists (select 1 from public.compliance_evaluation_results r
                      where r.evaluation_id = e.id and r.legal_obligation_id = o.id)
$$;

create or replace function app.compliance_results_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare st text; eval record;
begin
  select status, org_id, project_id into eval from public.compliance_evaluations where id = coalesce(new.evaluation_id, old.evaluation_id);
  st := eval.status;
  if tg_op = 'DELETE' then
    if st is null then return old; end if;
    if st <> 'draft' then raise exception 'A result in an issued evaluation is never removed.' using errcode = 'check_violation'; end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if st <> 'draft' then raise exception 'Results are recorded while the evaluation is a draft.' using errcode = 'check_violation'; end if;
    if not exists (select 1 from public.env_legal_obligations o where o.id = new.legal_obligation_id and o.org_id = eval.org_id
                    and (o.project_id is null or o.project_id = eval.project_id)) then
      raise exception 'That obligation is not in this evaluation''s register.' using errcode = 'check_violation';
    end if;
    new.done_at := null; new.created_at := now();
    return new;
  end if;
  if st = 'draft' then
    if new.evaluation_id is distinct from old.evaluation_id or new.legal_obligation_id is distinct from old.legal_obligation_id then
      raise exception 'A result stays with its obligation.' using errcode = 'check_violation';
    end if;
    -- Done is stamped by the database, once; a later update neither sets nor moves it.
    if old.done_at is null and new.done_at is not null then new.done_at := now();
    elsif old.done_at is not null then new.done_at := old.done_at; end if;
    return new;
  end if;
  if old.done_at is not null then raise exception 'A done action is frozen.' using errcode = 'check_violation'; end if;
  if new.result is distinct from old.result or new.evidence is distinct from old.evidence or new.action is distinct from old.action
     or new.owner_name is distinct from old.owner_name or new.due_on is distinct from old.due_on
     or new.evaluation_id is distinct from old.evaluation_id or new.legal_obligation_id is distinct from old.legal_obligation_id then
    raise exception 'A result in an issued evaluation does not change; only its action is marked done.' using errcode = 'check_violation';
  end if;
  if new.done_at is not null then new.done_at := now(); end if;
  return new;
end; $$;

-- The same done-date rule for audit findings on a draft report.
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
    if old.done_at is null and new.done_at is not null then new.done_at := now();
    elsif old.done_at is not null then new.done_at := old.done_at; end if;
    return new;
  end if;
  if old.done_at is not null then raise exception 'A done action is frozen.' using errcode = 'check_violation'; end if;
  if new.seq is distinct from old.seq or new.kind is distinct from old.kind or new.clause is distinct from old.clause
     or new.finding is distinct from old.finding or new.action is distinct from old.action or new.owner_name is distinct from old.owner_name
     or new.due_on is distinct from old.due_on or new.audit_id is distinct from old.audit_id then
    raise exception 'A finding in an issued report does not change; only its action is marked done.' using errcode = 'check_violation';
  end if;
  if new.done_at is not null then new.done_at := now(); end if;
  return new;
end; $$;

-- A link between an obligation and an aspect is added or removed, never repointed.
create or replace function app.env_obligation_aspects_no_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'Remove the link and add the right one.' using errcode = 'check_violation';
end; $$;
create trigger a_env_obligation_aspects_no_update before update on public.env_obligation_aspects
  for each row execute function app.env_obligation_aspects_no_update();

-- The register's history is itself never changed or removed — by anyone.
create trigger a_env_register_history_no_update before update on public.env_register_history
  for each row execute function app.frozen_row();
create trigger a_env_register_history_no_delete before delete on public.env_register_history
  for each row execute function app.frozen_row();

-- A limit can be a minimum (pH, dissolved oxygen) as well as a maximum (noise, dust, turbidity).
alter table public.env_monitoring_records
  add column limit_kind text not null default 'maximum' check (limit_kind in ('maximum', 'minimum'));

create or replace function app.env_monitoring_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.monitored_on > app.perth_today() then
    raise exception 'Monitoring is recorded once it is done.' using errcode = 'check_violation';
  end if;
  if new.value is not null and new.limit_value is not null then
    new.outcome := case
      when new.limit_kind = 'minimum' then case when new.value < new.limit_value then 'exceedance' else 'within_limit' end
      else case when new.value > new.limit_value then 'exceedance' else 'within_limit' end
    end;
    if new.outcome = 'exceedance' and length(btrim(coalesce(new.action_taken, ''))) = 0 then
      raise exception 'That reading is outside its limit — record what was done about it.' using errcode = 'check_violation';
    end if;
  end if;
  if new.equipment_id is not null and not exists (
    select 1 from public.measuring_equipment m join public.projects p on p.org_id = m.org_id
     where m.id = new.equipment_id and p.id = new.project_id) then
    raise exception 'That instrument is not this company''s.' using errcode = 'check_violation';
  end if;
  new.recorded_by := coalesce((select auth.uid()), new.recorded_by);
  new.created_at := now();
  return new;
end; $$;

-- ---------------------------------------------------------------------------
-- Working under a head contractor
-- ---------------------------------------------------------------------------

-- A copy is superseded only by a copy of the same plan received on or after it.
create or replace function app.head_contractor_documents_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.received_on > app.perth_today() then
      raise exception 'A document is recorded once it is received.' using errcode = 'check_violation';
    end if;
    if new.file_path is not null and split_part(new.file_path, '/', 1) <> new.project_id::text then
      raise exception 'The file must be in this job''s folder.' using errcode = 'check_violation';
    end if;
    new.superseded_by := null;
    new.title := btrim(new.title);
    new.revision := nullif(btrim(coalesce(new.revision, '')), '');
    new.notes := nullif(btrim(coalesce(new.notes, '')), '');
    new.received_by := coalesce((select auth.uid()), new.received_by);
    new.created_at := now();
    return new;
  end if;
  if old.superseded_by is not null then
    raise exception 'A superseded document is frozen.' using errcode = 'check_violation';
  end if;
  if (to_jsonb(new) - 'superseded_by') is distinct from (to_jsonb(old) - 'superseded_by') then
    raise exception 'A received document does not change; record the newer revision instead.' using errcode = 'check_violation';
  end if;
  if new.superseded_by is not null and not exists (
    select 1 from public.head_contractor_documents d
     where d.id = new.superseded_by and d.project_id = old.project_id and d.kind = old.kind and d.id <> old.id
       and d.received_on >= old.received_on) then
    raise exception 'It is replaced only by a copy of the same plan on the same job, received on or after it.' using errcode = 'check_violation';
  end if;
  return new;
end; $$;

-- The site's emergency plan and site rules are the workers' to read (reg. 43) — a labourer included —
-- when the head contractor's copy is what the job works to. Other plans stay with the record readers.
drop policy if exists head_contractor_documents_select on public.head_contractor_documents;
create policy head_contractor_documents_select on public.head_contractor_documents for select to authenticated
  using (app.is_project_member(project_id) and (app.reads_record(project_id) or kind in ('emergency_plan', 'site_rules')));
drop policy if exists "head contractor documents readable by record readers" on storage.objects;
create policy "head contractor documents readable by record readers" on storage.objects
  for select to authenticated
  using (bucket_id = 'head-contractor-docs'
         and app.is_project_member(app.storage_project_id(name))
         and (app.reads_record(app.storage_project_id(name))
              or exists (select 1 from public.head_contractor_documents d
                          where d.file_path = name and d.kind in ('emergency_plan', 'site_rules'))));

-- A reply from the head contractor cannot be dated before the submission it answers.
create or replace function app.swms_reviews_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare st text; last_submitted date;
begin
  select status into st from public.swms where id = new.swms_id;
  if st not in ('draft', 'active') then
    raise exception 'Only a draft or the version in use goes to the head contractor.' using errcode = 'check_violation';
  end if;
  if new.happened_on > app.perth_today() then
    raise exception 'That date is in the future.' using errcode = 'check_violation';
  end if;
  if new.kind in ('accepted', 'returned') then
    select max(happened_on) into last_submitted from public.swms_reviews r where r.swms_id = new.swms_id and r.kind = 'submitted';
    if last_submitted is null then
      raise exception 'Record it as submitted first.' using errcode = 'check_violation';
    end if;
    if new.happened_on < last_submitted then
      raise exception 'Their reply cannot be dated before it was submitted (%).', to_char(last_submitted, 'DD/MM/YYYY') using errcode = 'check_violation';
    end if;
  end if;
  new.person_name := nullif(btrim(coalesce(new.person_name, '')), '');
  new.reference := nullif(btrim(coalesce(new.reference, '')), '');
  new.comments := nullif(btrim(coalesce(new.comments, '')), '');
  new.created_by := coalesce((select auth.uid()), new.created_by);
  new.created_at := clock_timestamp();
  return new;
end; $$;

-- A draft SWMS that was submitted can still be deleted as a draft; its review steps go with it. A SWMS
-- in use or superseded is never deleted (its own rules), so its trail stays.
alter table public.swms_reviews drop constraint swms_reviews_swms_id_fkey;
alter table public.swms_reviews add constraint swms_reviews_swms_id_fkey foreign key (swms_id) references public.swms (id) on delete cascade;
create or replace function app.swms_reviews_no_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Deleted with its draft (the parent is already gone): allowed. Anything else: frozen.
  if not exists (select 1 from public.swms s where s.id = old.swms_id) then return old; end if;
  raise exception 'This record is never changed or removed.' using errcode = 'check_violation';
end; $$;
drop trigger if exists a_swms_reviews_no_delete on public.swms_reviews;
create trigger a_swms_reviews_no_delete before delete on public.swms_reviews
  for each row execute function app.swms_reviews_no_delete();

-- ---------------------------------------------------------------------------
-- Older register code: dates stamped in Perth, not UTC (README R77's rule, in SQL)
-- ---------------------------------------------------------------------------
create or replace function public.set_variation_status(p_register_id uuid, p_status public.variation_status, p_note text default null)
returns public.variation_register language plpgsql security definer set search_path = public as $$
declare v_row public.variation_register;
begin
  select * into v_row from public.variation_register where id = p_register_id;
  if not found or not app.can_manage_registers(v_row.project_id) then
    raise exception 'Your role on this job does not include the variation register.';
  end if;
  update public.variation_register r
     set status       = p_status,
         submitted_on = case when p_status = 'submitted' then coalesce(r.submitted_on, app.perth_today()) else r.submitted_on end,
         decided_on   = case when p_status in ('approved', 'rejected') then coalesce(r.decided_on, app.perth_today()) else r.decided_on end,
         paid_on      = case when p_status = 'paid' then coalesce(r.paid_on, app.perth_today()) else r.paid_on end
   where r.id = p_register_id returning * into v_row;
  insert into public.variation_status_events (register_id, status, note, changed_by)
  values (p_register_id, p_status, nullif(btrim(coalesce(p_note, '')), ''), auth.uid());
  return v_row;
end; $$;

create or replace function public.set_daywork_docket(p_daywork_id uuid, p_docket_ref text, p_note text default null)
returns public.daywork_dockets language plpgsql security definer set search_path = public as $$
declare v_project uuid; v_on_record text; v_row public.daywork_dockets;
begin
  select e.project_id, dw.docket_ref into v_project, v_on_record
    from public.dayworks dw join public.entries e on e.id = dw.entry_id where dw.id = p_daywork_id;
  if not found or not app.can_manage_registers(v_project) then
    raise exception 'Your role on this job does not include dockets.';
  end if;
  if v_on_record is not null and btrim(v_on_record) <> '' then
    raise exception 'That daywork already carries docket % on the signed record.', v_on_record;
  end if;
  if p_docket_ref is null or btrim(p_docket_ref) = '' then raise exception 'A docket number is required.'; end if;
  insert into public.daywork_dockets (daywork_id, docket_ref, note, recorded_by, received_on)
  values (p_daywork_id, btrim(p_docket_ref), nullif(btrim(coalesce(p_note, '')), ''), auth.uid(), app.perth_today())
  on conflict (daywork_id) do update
    set docket_ref = excluded.docket_ref, note = excluded.note, recorded_by = excluded.recorded_by, recorded_at = now(), received_on = app.perth_today()
  returning * into v_row;
  return v_row;
end; $$;
alter table public.daywork_dockets alter column received_on set default app.perth_today();
