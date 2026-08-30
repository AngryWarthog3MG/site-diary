-- ============================================================================
-- 20260901090100_project_settings.sql
-- Letting an admin edit a project, and the one thing they must not edit.
--
-- Names, contractors, coordinates and station ids are all fair game — sites get
-- renamed, contractors change, someone fat-fingers a coordinate.
--
-- Codes are different. `KBS_C001_DD_142` is stamped into every signed entry and
-- into the content hash that makes it verifiable. Changing either code after an
-- entry is signed leaves the diary with two prefixes for one project and a
-- serial run that reads as though entries are missing. Before anything is
-- signed it costs nothing, so the rule is: editable until the first signature,
-- fixed forever after.
-- ============================================================================

create or replace function app.lock_project_code()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- A project never moves between organisations: its entry numbers carry the
  -- org code, and moving it would silently re-parent signed history.
  if new.org_id is distinct from old.org_id then
    raise exception 'A project cannot be moved to another organisation.'
      using errcode = 'restrict_violation';
  end if;

  if new.code is distinct from old.code
     and exists (select 1 from public.entries e
                  where e.project_id = old.id and e.status = 'signed') then
    raise exception
      'Project code cannot change: entries have been signed as %_%_DD_… and that prefix is part of the record.',
      (select o.code from public.organisations o where o.id = old.org_id), old.code
      using errcode = 'restrict_violation',
            hint = 'Set up a new project instead — the existing entries stay where they are.';
  end if;

  return new;
end;
$$;

create trigger projects_lock_code
  before update on public.projects
  for each row execute function app.lock_project_code();

create or replace function app.lock_org_code()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.code is distinct from old.code
     and exists (select 1
                   from public.entries e
                   join public.projects p on p.id = e.project_id
                  where p.org_id = old.id and e.status = 'signed') then
    raise exception
      'Organisation code cannot change: entries have been signed under %_… and that prefix is part of the record.',
      old.code
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$$;

create trigger organisations_lock_code
  before update on public.organisations
  for each row execute function app.lock_org_code();

-- ---------------------------------------------------------------------------
-- Whether the codes are still editable, for the settings screen to ask.
-- ---------------------------------------------------------------------------
create or replace function public.project_settings_state(p_project_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when not app.is_project_member(p_project_id) then null
    else jsonb_build_object(
      'can_edit', app.is_project_admin(p_project_id)
                  or app.is_org_admin((select p.org_id from public.projects p
                                        where p.id = p_project_id)),
      'signed_entries', (select count(*) from public.entries e
                          where e.project_id = p_project_id and e.status = 'signed'),
      'code_locked', exists (select 1 from public.entries e
                              where e.project_id = p_project_id and e.status = 'signed'),
      'org_code_locked', exists (
        select 1 from public.entries e
          join public.projects p on p.id = e.project_id
         where p.org_id = (select p2.org_id from public.projects p2 where p2.id = p_project_id)
           and e.status = 'signed')
    )
  end;
$$;

grant execute on function public.project_settings_state(uuid) to authenticated, service_role;
