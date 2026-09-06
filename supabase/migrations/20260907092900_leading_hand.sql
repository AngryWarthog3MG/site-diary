-- ============================================================================
-- 20260907092900_leading_hand.sql
-- A role between supervisor and PM: the leading hand.
--
-- Runs the morning prestart and the toolbox talk, reads the signed diary and
-- the weekly — and records nothing. Supervisors write the record; PMs read
-- it; the leading hand keeps the crew safe and briefed. Added because the
-- first one is starting on Curtin this week.
--
-- The new enum value cannot be referenced as an enum literal in the same
-- transaction that adds it, so the permission compares as text.
-- ============================================================================

alter type public.member_role add value if not exists 'leading_hand';

create or replace function app.can_run_talks(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.project_members pm
     where pm.project_id = p_project
       and pm.user_id = (select auth.uid())
       and pm.role::text in ('supervisor', 'admin', 'leading_hand')
  )
$$;

comment on function app.can_run_talks(uuid) is
  'Supervisors, admins and leading hands run prestarts and toolbox talks on their projects.';
