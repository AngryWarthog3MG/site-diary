-- A supervisor records a crew signature by hand for people without accounts — never their own (README R120). Their
-- own goes through the self policy, which asks for their name and the passed check; this closes the way round it.
drop policy document_acknowledgements_insert_crew on public.document_acknowledgements;
create policy document_acknowledgements_insert_crew on public.document_acknowledgements
  for insert to authenticated
  with check (
    recorded_by = (select auth.uid()) and project_id is not null and app.can_run_talks(project_id)
    and regexp_replace(lower(btrim(person_name)), '\s+', ' ', 'g')
        is distinct from (select regexp_replace(lower(btrim(coalesce(pr.full_name, ''))), '\s+', ' ', 'g') from public.profiles pr where pr.id = (select auth.uid()))
  );
