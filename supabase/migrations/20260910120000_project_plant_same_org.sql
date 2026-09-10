-- A job may only carry machines from its own organisation. The write policy
-- checked the caller's right to the project and nothing about the machine, so
-- anyone who runs prestarts could link another organisation's plant id to
-- their job. Codex pass 7.
drop policy if exists project_plant_write_crew on public.project_plant;
create policy project_plant_write_crew on public.project_plant
  for all to authenticated
  using (app.can_run_talks(project_id))
  with check (
    app.can_run_talks(project_id)
    and exists (
      select 1
        from public.plant_register r
        join public.projects p on p.org_id = r.org_id
       where r.id = plant_id and p.id = project_id
    )
  );
