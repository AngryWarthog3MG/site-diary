-- ============================================================================
-- The closeout loop (README R93): a job's own items become the company's.
--
-- Every setup item a job added by hand or read from its contract is one the
-- library never had. At closeout — or whenever the office likes — each is
-- decided once: PROMOTED into a module of the company's templates, reworded
-- generically, or LEFT as a one-off. Promotion inserts the template_items row
-- (origin carried: manual or contract, so the library remembers where an
-- item came from) and stamps the setup item with what it became. A promoted
-- item is not stamped back onto the job that gave it (instantiate_project
-- skips it), so re-stamping never doubles it up.
--
-- A template is generic: the DB refuses a promoted title or detail that names
-- the head contractor or the job. The decision columns are written only by
-- the two functions; the trigger refuses a direct write.
-- ============================================================================

alter table public.project_setup_items
  add column promotion_decision text check (promotion_decision is null or promotion_decision in ('promoted', 'one_off')),
  add column promoted_template_item_id uuid references public.template_items (id),
  add column decided_at timestamptz,
  add column decided_by uuid references auth.users (id);
comment on column public.project_setup_items.promotion_decision is 'The closeout decision: promoted into the templates, or left as a one-off. Null until decided. Only origin manual/contract items are decided.';

create or replace function app.project_setup_items_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.title := regexp_replace(btrim(new.title), '\s+', ' ', 'g');
  new.category := nullif(regexp_replace(btrim(coalesce(new.category, '')), '\s+', ' ', 'g'), '');
  new.owner_name := nullif(regexp_replace(btrim(coalesce(new.owner_name, '')), '\s+', ' ', 'g'), '');
  new.detail := nullif(btrim(coalesce(new.detail, '')), '');
  new.unit := nullif(btrim(coalesce(new.unit, '')), '');
  new.status_note := nullif(btrim(coalesce(new.status_note, '')), '');
  new.evidence := nullif(btrim(coalesce(new.evidence, '')), '');
  if new.kind in ('document', 'folder') and new.folder_no is null then
    raise exception 'A document or folder item names its folder (1–12).' using errcode = 'check_violation';
  end if;
  if new.kind = 'consumable' and new.par_level is not null and new.unit is null then
    raise exception 'A par level needs a unit.' using errcode = 'check_violation';
  end if;
  if tg_op = 'INSERT' then
    -- Born open and undecided; the DB alone stamps done, and only the closeout functions decide.
    new.status := 'open'; new.done_at := null; new.done_by := null;
    new.promotion_decision := null; new.promoted_template_item_id := null; new.decided_at := null; new.decided_by := null;
    new.created_by := coalesce((select auth.uid()), new.created_by);
    new.created_at := now();
  else
    if new.project_id <> old.project_id or new.template_item_id is distinct from old.template_item_id
       or new.origin <> old.origin or new.kind <> old.kind
       or new.created_by is distinct from old.created_by or new.created_at <> old.created_at then
      raise exception 'A setup item stays what it was stamped as; mark it not applicable instead.' using errcode = 'check_violation';
    end if;
    -- The closeout decision is written by promote_setup_item / leave_setup_item alone (README R93).
    if (new.promotion_decision is distinct from old.promotion_decision
        or new.promoted_template_item_id is distinct from old.promoted_template_item_id
        or new.decided_at is distinct from old.decided_at
        or new.decided_by is distinct from old.decided_by)
       and coalesce(current_setting('app.closeout', true), '') <> 'on' then
      raise exception 'The closeout decision is made through promote or leave, not written directly.' using errcode = 'check_violation';
    end if;
    if new.status <> old.status then
      if new.status = 'open' then
        new.done_at := null; new.done_by := null;
      else
        new.done_at := now(); new.done_by := coalesce((select auth.uid()), new.done_by);
      end if;
    else
      new.done_at := old.done_at; new.done_by := old.done_by;
    end if;
  end if;
  new.updated_at := now();
  return new;
end; $$;

-- Promote: reworded generically, into one module, at one tier. Returns the new template item's id.
create or replace function public.promote_setup_item(
  p_item uuid, p_module text, p_title text,
  p_category text default null, p_detail text default null,
  p_min_tier text default 'full', p_priority text default null, p_owner_role text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  it        public.project_setup_items%rowtype;
  v_org     uuid;
  v_hc      text;
  v_job     text;
  v_title   text := regexp_replace(btrim(coalesce(p_title, '')), '\s+', ' ', 'g');
  v_detail  text := nullif(btrim(coalesce(p_detail, '')), '');
  v_new     uuid;
begin
  select * into it from public.project_setup_items where id = p_item;
  if it.id is null then raise exception 'No such setup item.' using errcode = 'no_data_found'; end if;
  if (select auth.uid()) is not null and not app.is_office(it.project_id) then
    raise exception 'Only the office decides what a job gives back to the templates.' using errcode = 'insufficient_privilege';
  end if;
  if it.origin = 'template' then
    raise exception 'This item came from the library already; there is nothing to promote.' using errcode = 'check_violation';
  end if;
  if it.promoted_template_item_id is not null then
    raise exception 'This item has already been promoted.' using errcode = 'check_violation';
  end if;
  if length(v_title) = 0 then raise exception 'The template item needs a title.' using errcode = 'check_violation'; end if;
  if coalesce(p_min_tier, 'full') not in ('light', 'full') then raise exception 'Tier is light or full.' using errcode = 'check_violation'; end if;
  select p.org_id, nullif(btrim(coalesce(p.principal_contractor, '')), ''), btrim(p.name) into v_org, v_hc, v_job
    from public.projects p where p.id = it.project_id;
  -- Generic: no head contractor, no job name.
  if v_hc is not null and (position(lower(v_hc) in lower(v_title)) > 0 or position(lower(v_hc) in lower(coalesce(v_detail, ''))) > 0) then
    raise exception 'A template is generic: it must not name the head contractor (“%”).', v_hc using errcode = 'check_violation';
  end if;
  if length(v_job) > 0 and (position(lower(v_job) in lower(v_title)) > 0 or position(lower(v_job) in lower(coalesce(v_detail, ''))) > 0) then
    raise exception 'A template is generic: it must not name the job (“%”).', v_job using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.template_modules m where m.org_id = v_org and m.key = p_module and m.active) then
    raise exception 'This company''s templates have no module called %.', p_module using errcode = 'check_violation';
  end if;

  insert into public.template_items
    (org_id, module_key, kind, category, title, detail, priority, min_tier, owner_role, due_offset_days, unit, par_level, folder_no, sort, origin, created_by)
  values
    (v_org, p_module, it.kind, nullif(btrim(coalesce(p_category, '')), ''), v_title, v_detail,
     case when p_priority in ('A', 'B', 'C') then p_priority end, coalesce(p_min_tier, 'full'),
     case when p_owner_role in ('office', 'site') then p_owner_role end,
     it.due_offset_days, it.unit, it.par_level, it.folder_no, it.sort, it.origin, (select auth.uid()))
  returning id into v_new;

  perform set_config('app.closeout', 'on', true);
  update public.project_setup_items
     set promotion_decision = 'promoted', promoted_template_item_id = v_new, decided_at = now(), decided_by = (select auth.uid())
   where id = p_item;
  perform set_config('app.closeout', 'off', true);
  return v_new;
end; $$;
revoke all on function public.promote_setup_item(uuid, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.promote_setup_item(uuid, text, text, text, text, text, text, text) to authenticated, service_role;

-- Leave as a one-off. Can be revisited: a one-off may still be promoted later; a promotion is final.
create or replace function public.leave_setup_item(p_item uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare it public.project_setup_items%rowtype;
begin
  select * into it from public.project_setup_items where id = p_item;
  if it.id is null then raise exception 'No such setup item.' using errcode = 'no_data_found'; end if;
  if (select auth.uid()) is not null and not app.is_office(it.project_id) then
    raise exception 'Only the office decides what a job gives back to the templates.' using errcode = 'insufficient_privilege';
  end if;
  if it.origin = 'template' then
    raise exception 'This item came from the library already; there is nothing to decide.' using errcode = 'check_violation';
  end if;
  if it.promoted_template_item_id is not null then
    raise exception 'This item has already been promoted.' using errcode = 'check_violation';
  end if;
  perform set_config('app.closeout', 'on', true);
  update public.project_setup_items
     set promotion_decision = 'one_off', promoted_template_item_id = null, decided_at = now(), decided_by = (select auth.uid())
   where id = p_item;
  perform set_config('app.closeout', 'off', true);
end; $$;
revoke all on function public.leave_setup_item(uuid) from public, anon;
grant execute on function public.leave_setup_item(uuid) to authenticated, service_role;

-- instantiate_project: skip what this job itself promoted.
create or replace function public.instantiate_project(p_project uuid, p_modules text[] default '{}', p_tier text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_org     uuid;
  v_tier    text;
  v_start   date;
  v_mod     text;
  v_added   integer := 0;
  v_by_kind jsonb := '{}'::jsonb;
begin
  select org_id, tier, start_on into v_org, v_tier, v_start from public.projects where id = p_project;
  if v_org is null then
    raise exception 'No such job.' using errcode = 'no_data_found';
  end if;
  -- The office sets a job up. A null uid is the service role (create_project's own call, the operator path).
  if (select auth.uid()) is not null and not app.is_office(p_project) then
    raise exception 'Only the office — a PM or admin on the job — sets it up from the templates.' using errcode = 'insufficient_privilege';
  end if;
  if p_tier is not null then
    if p_tier not in ('light', 'full') then
      raise exception 'A job''s tier is light or full.' using errcode = 'check_violation';
    end if;
    if not exists (select 1 from public.project_modules where project_id = p_project) then
      -- The first stamping sets the tier: every job carries 'full' from birth, and there is nothing on an
      -- empty board to take off. From then on a tier only rises — stamping more is additive; stamping
      -- less would mean removing what is already on the board.
      if v_tier <> p_tier then
        update public.projects set tier = p_tier where id = p_project;
        v_tier := p_tier;
      end if;
    elsif p_tier = 'full' and v_tier = 'light' then
      update public.projects set tier = 'full' where id = p_project;
      v_tier := 'full';
    end if;
  end if;

  foreach v_mod in array (array['core'] || coalesce(p_modules, '{}'::text[])) loop
    if not exists (select 1 from public.template_modules m where m.org_id = v_org and m.key = v_mod and m.active) then
      raise exception 'This company''s templates have no module called %.', v_mod using errcode = 'check_violation';
    end if;
    insert into public.project_modules (project_id, module_key, attached_by)
    values (p_project, v_mod, (select auth.uid()))
    on conflict do nothing;
  end loop;

  with stamped as (
    insert into public.project_setup_items
      (project_id, template_item_id, module_key, kind, category, title, detail, priority, owner_role,
       due_offset_days, due_on, unit, par_level, folder_no, sort, origin, created_by)
    select p_project, t.id, t.module_key, t.kind, t.category, t.title, t.detail, t.priority, t.owner_role,
           t.due_offset_days,
           case when v_start is not null and t.due_offset_days is not null then v_start + t.due_offset_days end,
           t.unit, t.par_level, t.folder_no, t.sort, 'template', (select auth.uid())
      from public.template_items t
      join public.project_modules pm on pm.project_id = p_project and pm.module_key = t.module_key
     where t.org_id = v_org
       and t.active
       and (v_tier = 'full' or t.min_tier = 'light')
       and not exists (select 1 from public.project_setup_items s where s.project_id = p_project and s.template_item_id = t.id)
       -- An item this job promoted into the library is already on this job's board under its own name.
       and not exists (select 1 from public.project_setup_items s where s.project_id = p_project and s.promoted_template_item_id = t.id)
     order by t.module_key, t.kind, t.sort, t.title
    returning kind
  ), per_kind as (
    select kind, count(*)::integer as n from stamped group by kind
  )
  select coalesce(sum(n), 0)::integer, coalesce(jsonb_object_agg(kind, n), '{}'::jsonb)
    into v_added, v_by_kind
    from per_kind;

  return jsonb_build_object(
    'added', v_added,
    'by_kind', v_by_kind,
    'tier', v_tier,
    'modules', (select jsonb_agg(module_key order by module_key) from public.project_modules where project_id = p_project)
  );
end; $$;
