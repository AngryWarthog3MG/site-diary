-- A labourer checks the plant they operate, on the jobs they are on (README R162).
--
-- Mitchell: "allow labour to sign off plant for the jobs they are assigned to also — Marcus on Curtin needs to
-- complete prestarts on machines." The plant prestart was a talk-runner's write (supervisor, leading hand, admin, PM).
-- The operator is the person who walks around the machine, and on Curtin that is often a labourer. So, like signing
-- on to the prestart or a SWMS as yourself (R89, R141), a member of the job may make a plant check in THEIR OWN NAME:
-- the operator must be the caller's profile name, the row is theirs (conducted_by), they complete it with their own
-- signature, and they raise its defects. The talk-runners keep everything they had. The ticket rule is unchanged —
-- the database still refuses a signature from an operator whose recorded tickets do not cover the machine — and so
-- a labourer may now read their OWN tickets, their own checks and their own defects, and nothing else of the record.

create or replace function app.can_check_own_plant(p_project uuid, p_operator text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.profiles pr
     where pr.id = (select auth.uid())
       and app.is_project_member(p_project)
       and pr.full_name is not null
       and lower(regexp_replace(btrim(pr.full_name), '\s+', ' ', 'g'))
         = lower(regexp_replace(btrim(coalesce(p_operator, '')), '\s+', ' ', 'g'))
  );
$$;
grant execute on function app.can_check_own_plant(uuid, text) to authenticated;

-- The open check is writable by a talk-runner, or by the operator themselves when it is their own.
create or replace function app.can_write_plant_prestart(p_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.plant_prestarts s
     where s.id = p_id
       and s.completed_at is null
       and (app.can_run_talks(s.project_id)
            or (s.conducted_by = (select auth.uid()) and app.can_check_own_plant(s.project_id, s.operator_name)))
  );
$$;

drop policy if exists plant_prestarts_insert_crew on public.plant_prestarts;
create policy plant_prestarts_insert_crew on public.plant_prestarts
  for insert to authenticated
  with check (conducted_by = (select auth.uid())
              and (app.can_run_talks(project_id) or app.can_check_own_plant(project_id, operator_name)));
drop policy if exists plant_prestarts_update_open on public.plant_prestarts;
create policy plant_prestarts_update_open on public.plant_prestarts
  for update to authenticated
  using (completed_at is null
         and (app.can_run_talks(project_id)
              or (conducted_by = (select auth.uid()) and app.can_check_own_plant(project_id, operator_name))))
  with check (app.can_run_talks(project_id)
              or (conducted_by = (select auth.uid()) and app.can_check_own_plant(project_id, operator_name)));

drop policy if exists plant_defects_insert_crew on public.plant_defects;
create policy plant_defects_insert_crew on public.plant_defects
  for insert to authenticated
  with check (raised_by = (select auth.uid())
              and (app.can_run_talks(project_id)
                   or exists (select 1 from public.plant_prestarts s
                               where s.id = prestart_id and s.project_id = plant_defects.project_id
                                 and s.conducted_by = (select auth.uid())
                                 and app.can_check_own_plant(s.project_id, s.operator_name))));

-- What a labourer reads of the record: their own checks, their own defects, their own tickets. Nothing else moves.
drop policy if exists plant_prestarts_reads_record on public.plant_prestarts;
create policy plant_prestarts_reads_record on public.plant_prestarts as restrictive for select to authenticated
  using (app.reads_record(project_id) or conducted_by = (select auth.uid()));
drop policy if exists plant_defects_reads_record on public.plant_defects;
create policy plant_defects_reads_record on public.plant_defects as restrictive for select to authenticated
  using (app.reads_record(project_id) or raised_by = (select auth.uid()));
drop policy if exists crew_tickets_reads_record on public.crew_tickets;
create policy crew_tickets_reads_record on public.crew_tickets as restrictive for select to authenticated
  using (app.reads_org_record(org_id)
         or exists (select 1 from public.profiles pr
                     where pr.id = (select auth.uid())
                       and lower(regexp_replace(btrim(coalesce(pr.full_name, '')), '\s+', ' ', 'g'))
                         = lower(regexp_replace(btrim(person_name), '\s+', ' ', 'g'))));
