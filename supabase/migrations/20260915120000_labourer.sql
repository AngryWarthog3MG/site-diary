-- ============================================================================
-- 20260915120000_labourer.sql
-- A fourth crew role: the labourer.
--
-- Signs in and out at the gate and reports hazards and incidents — and does
-- nothing else. No diary, no prestarts or talks, no plant, no orders, no
-- registers. Added because Mitchell is putting the whole crew on the app over
-- the next fortnight, and most of them need exactly these two doors.
--
-- Two new permissions say who may sign in and who may report, so the wider
-- gate-duty permission (app.can_run_talks) stays what it was. The new enum
-- value cannot be used as a literal in the transaction that adds it, so the
-- permissions compare as text.
-- ============================================================================

alter type public.member_role add value if not exists 'labourer';

create or replace function app.can_sign_in(p_project uuid)
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
       and pm.role::text in ('supervisor', 'admin', 'leading_hand', 'labourer')
  )
$$;
grant execute on function app.can_sign_in(uuid) to authenticated;
comment on function app.can_sign_in(uuid) is
  'Who signs people in and out at the gate: gate duty plus labourers.';

create or replace function app.can_report(p_project uuid)
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
       and pm.role::text in ('supervisor', 'admin', 'leading_hand', 'labourer')
  )
$$;
grant execute on function app.can_report(uuid) to authenticated;
comment on function app.can_report(uuid) is
  'Who reports a hazard or incident and adds updates to one: gate duty plus labourers.';

-- The gate.
drop policy if exists site_signins_insert_crew on public.site_signins;
drop policy if exists site_signins_signout_crew on public.site_signins;
drop policy if exists site_signins_delete_own_open on public.site_signins;
create policy site_signins_insert_crew on public.site_signins
  for insert to authenticated
  with check (app.can_sign_in(project_id) and signed_in_by = (select auth.uid()));
create policy site_signins_signout_crew on public.site_signins
  for update to authenticated
  using (app.can_sign_in(project_id) and signed_out_at is null)
  with check (app.can_sign_in(project_id));
create policy site_signins_delete_own_open on public.site_signins
  for delete to authenticated
  using (signed_in_by = (select auth.uid()) and signed_out_at is null and app.can_sign_in(project_id));

-- Reporting.
drop policy if exists incidents_insert_crew on public.incidents;
drop policy if exists incident_updates_insert_crew on public.incident_updates;
drop policy if exists "incident photos writable by crew" on storage.objects;
create policy incidents_insert_crew on public.incidents
  for insert to authenticated
  with check (app.can_report(project_id) and reported_by = (select auth.uid()));
create policy incident_updates_insert_crew on public.incident_updates
  for insert to authenticated
  with check (created_by = (select auth.uid())
              and exists (select 1 from public.incidents i where i.id = incident_id and app.can_report(i.project_id)));
create policy "incident photos writable by crew" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'entry-photos'
    and (storage.foldername(name))[2] = 'incident'
    and app.can_report(((storage.foldername(name))[1])::uuid)
  );
