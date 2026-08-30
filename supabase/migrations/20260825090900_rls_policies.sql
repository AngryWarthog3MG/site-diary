-- ============================================================================
-- 20260825090900_rls_policies.sql
-- Row Level Security, scoped by project membership (brief §2).
--
-- Role model:
--   supervisor  read the project, author and sign their own entries
--   pm          read only — the record is written on site, not in the office
--   admin       read the project, author entries, manage membership and project
--
-- Nothing is readable by `anon`. Every policy is `to authenticated`.
-- ============================================================================

revoke all on all tables in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;

alter table public.profiles         enable row level security;
alter table public.organisations    enable row level security;
alter table public.projects         enable row level security;
alter table public.project_members  enable row level security;
alter table public.entries          enable row level security;
alter table public.entry_sections   enable row level security;
alter table public.labour           enable row level security;
alter table public.plant            enable row level security;
alter table public.work_items       enable row level security;
alter table public.variations       enable row level security;
alter table public.delays           enable row level security;
alter table public.pours            enable row level security;
alter table public.quantities       enable row level security;
alter table public.weather          enable row level security;
alter table public.photos           enable row level security;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create policy profiles_select_self_or_teammate on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or app.shares_project_with(id));

create policy profiles_insert_self on public.profiles
  for insert to authenticated
  with check (id = (select auth.uid()));

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- organisations — created by service role during onboarding
-- ---------------------------------------------------------------------------
create policy organisations_select_member on public.organisations
  for select to authenticated
  using (app.is_org_member(id));

create policy organisations_update_admin on public.organisations
  for update to authenticated
  using (app.is_org_admin(id))
  with check (app.is_org_admin(id));

-- ---------------------------------------------------------------------------
-- projects
-- ---------------------------------------------------------------------------
create policy projects_select_member on public.projects
  for select to authenticated
  using (app.is_project_member(id) or app.is_org_admin(org_id));

create policy projects_insert_org_admin on public.projects
  for insert to authenticated
  with check (app.is_org_admin(org_id));

create policy projects_update_admin on public.projects
  for update to authenticated
  using (app.is_project_admin(id) or app.is_org_admin(org_id))
  with check (app.is_project_admin(id) or app.is_org_admin(org_id));

-- No delete policy: projects carry legal records and are deactivated, not deleted.

-- ---------------------------------------------------------------------------
-- project_members
-- ---------------------------------------------------------------------------
create policy project_members_select_member on public.project_members
  for select to authenticated
  using (app.is_project_member(project_id));

create policy project_members_insert_admin on public.project_members
  for insert to authenticated
  with check (app.is_project_admin(project_id) or app.is_org_admin(
    (select p.org_id from public.projects p where p.id = project_id)));

create policy project_members_update_admin on public.project_members
  for update to authenticated
  using (app.is_project_admin(project_id))
  with check (app.is_project_admin(project_id));

create policy project_members_delete_admin on public.project_members
  for delete to authenticated
  using (app.is_project_admin(project_id));

-- ---------------------------------------------------------------------------
-- entries
-- ---------------------------------------------------------------------------
create policy entries_select_member on public.entries
  for select to authenticated
  using (app.is_project_member(project_id));

create policy entries_insert_author on public.entries
  for insert to authenticated
  with check (
    app.can_author_entries(project_id)
    and author_id = (select auth.uid())
    and status = 'draft'
  );

-- USING is evaluated against the pre-update row, so only unsigned drafts owned
-- by the caller are updatable at all. WITH CHECK permits the draft -> signed
-- transition; app.entries_enforce_immutable() locks the row from then on.
create policy entries_update_own_draft on public.entries
  for update to authenticated
  using (author_id = (select auth.uid()) and status = 'draft')
  with check (author_id = (select auth.uid()));

create policy entries_delete_own_draft on public.entries
  for delete to authenticated
  using (author_id = (select auth.uid()) and status = 'draft');

-- ---------------------------------------------------------------------------
-- Child tables — readable by any project member, writable only on your own
-- unsigned draft.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'entry_sections', 'labour', 'plant', 'work_items', 'variations',
    'delays', 'pours', 'quantities', 'weather', 'photos'
  ] loop
    execute format($f$
      create policy %I on public.%I
        for select to authenticated
        using (app.can_read_entry(entry_id));
    $f$, t || '_select_member', t);

    execute format($f$
      create policy %I on public.%I
        for insert to authenticated
        with check (app.can_write_entry(entry_id));
    $f$, t || '_insert_own_draft', t);

    execute format($f$
      create policy %I on public.%I
        for update to authenticated
        using (app.can_write_entry(entry_id))
        with check (app.can_write_entry(entry_id));
    $f$, t || '_update_own_draft', t);

    execute format($f$
      create policy %I on public.%I
        for delete to authenticated
        using (app.can_write_entry(entry_id));
    $f$, t || '_delete_own_draft', t);
  end loop;
end;
$$;
