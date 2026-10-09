-- The project manager keeps the plant register too (README R136) — missed by 20261009100000.
create or replace function app.can_manage_plant(p_org_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.project_members pm
      join public.projects p on p.id = pm.project_id
     where p.org_id = p_org_id
       and pm.user_id = auth.uid()
       and pm.role in ('supervisor', 'leading_hand', 'admin', 'pm')
  );
$$;
