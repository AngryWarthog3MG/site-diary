-- ============================================================================
-- The first stamping sets a job's tier (README R92).
--
-- Every job carries tier 'full' from birth (the column's default), so the
-- office picking 'light' when setting an existing job up for the first time
-- was silently ignored by "a tier only rises". A job with no modules attached
-- has nothing on its board to take off: its first stamping takes the tier it
-- is given. After that the rule stands — a tier only rises.
-- ============================================================================

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
