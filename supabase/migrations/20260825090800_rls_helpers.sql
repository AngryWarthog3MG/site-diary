-- ============================================================================
-- 20260825090800_rls_helpers.sql
-- Membership predicates used by every RLS policy.
--
-- All SECURITY DEFINER, so a policy on project_members can consult
-- project_members without recursing through its own policy. They live in the
-- private `app` schema and are not reachable through PostgREST.
-- ============================================================================

create or replace function app.current_user_id()
returns uuid
language sql
stable
set search_path = ''
as $$ select auth.uid() $$;

-- --------------------------------------------------------------------------
-- Project membership
-- --------------------------------------------------------------------------
create or replace function app.project_role(p_project_id uuid)
returns public.member_role
language sql
stable
security definer
set search_path = ''
as $$
  select m.role
    from public.project_members m
   where m.project_id = p_project_id
     and m.user_id = auth.uid();
$$;

create or replace function app.is_project_member(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select app.project_role(p_project_id) is not null $$;

create or replace function app.is_project_admin(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select app.project_role(p_project_id) = 'admin' $$;

-- Who may author a diary entry. PMs read; they do not write the record.
create or replace function app.can_author_entries(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select app.project_role(p_project_id) in ('supervisor', 'admin') $$;

-- --------------------------------------------------------------------------
-- Organisation membership, derived from project membership
-- --------------------------------------------------------------------------
create or replace function app.is_org_member(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.project_members m
      join public.projects p on p.id = m.project_id
     where p.org_id = p_org_id
       and m.user_id = auth.uid()
  );
$$;

create or replace function app.is_org_admin(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.project_members m
      join public.projects p on p.id = m.project_id
     where p.org_id = p_org_id
       and m.user_id = auth.uid()
       and m.role = 'admin'
  );
$$;

-- Can the current user see this person's profile? Only if they share a project.
create or replace function app.shares_project_with(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.project_members mine
      join public.project_members theirs on theirs.project_id = mine.project_id
     where mine.user_id = auth.uid()
       and theirs.user_id = p_user_id
  );
$$;

-- --------------------------------------------------------------------------
-- Entry access
-- --------------------------------------------------------------------------
create or replace function app.can_read_entry(p_entry_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.entries e
      join public.project_members m on m.project_id = e.project_id
     where e.id = p_entry_id
       and m.user_id = auth.uid()
  );
$$;

-- Child rows are writable only while the parent entry is an unsigned draft
-- belonging to the current user. The immutability triggers enforce the
-- signed half of this independently of RLS.
create or replace function app.can_write_entry(p_entry_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.entries e
     where e.id = p_entry_id
       and e.status = 'draft'
       and e.author_id = auth.uid()
  );
$$;

grant execute on function
  app.current_user_id(),
  app.project_role(uuid),
  app.is_project_member(uuid),
  app.is_project_admin(uuid),
  app.can_author_entries(uuid),
  app.is_org_member(uuid),
  app.is_org_admin(uuid),
  app.shares_project_with(uuid),
  app.can_read_entry(uuid),
  app.can_write_entry(uuid)
to authenticated, service_role;
