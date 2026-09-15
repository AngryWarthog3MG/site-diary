-- A labourer's sign-in is their own. The gate screen shows a labourer one button — their
-- name in, their name out — and no one else's row; the table now says the same, so a
-- hand-written call from a labourer's login cannot sign a workmate out or sign someone else
-- in (Codex pass A, 2026-09-16). Gate duty (supervisor, admin, leading hand) is unchanged.
--
-- "Their own" is judged by name, not by who tapped: a supervisor may sign the labourer in at
-- the gate by name, and the labourer must still be able to sign that row out. The name is the
-- profile's full name, or its email when no name is recorded — the same fallback the screen
-- uses for the one-tap button.
create or replace function app.signin_name_mine(p_project uuid, p_person text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (
      select 1 from public.project_members pm
       where pm.project_id = p_project
         and pm.user_id = (select auth.uid())
         and pm.role::text <> 'labourer'
    )
    or exists (
      select 1 from public.profiles pr
       where pr.id = (select auth.uid())
         and lower(btrim(p_person)) in (lower(btrim(coalesce(pr.full_name, ''))), lower(btrim(coalesce(pr.email, ''))))
         and lower(btrim(p_person)) <> ''
    )
$$;
grant execute on function app.signin_name_mine(uuid, text) to authenticated;
comment on function app.signin_name_mine(uuid, text) is
  'Gate duty may sign anyone; a labourer only a row carrying their own name (profile full name, or email when unnamed).';

drop policy if exists site_signins_insert_crew on public.site_signins;
drop policy if exists site_signins_signout_crew on public.site_signins;
create policy site_signins_insert_crew on public.site_signins
  for insert to authenticated
  with check (app.can_sign_in(project_id) and signed_in_by = (select auth.uid()) and app.signin_name_mine(project_id, person_name));
create policy site_signins_signout_crew on public.site_signins
  for update to authenticated
  using (app.can_sign_in(project_id) and signed_out_at is null and app.signin_name_mine(project_id, person_name))
  with check (app.can_sign_in(project_id) and app.signin_name_mine(project_id, person_name));
