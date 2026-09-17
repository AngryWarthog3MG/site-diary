-- ============================================================================
-- A labourer reads only the hazard and incident reports they made (README R75).
--
-- Mitchell, 17/09/2026, after seeing the labourer's screens: "only show labourers
-- their own reports". Until now a labourer, whose door is reporting, could read
-- every report on the job — injury reports marked notifiable included — with
-- their updates, actions and photos. Every other role is unchanged: anyone who
-- reads the record (app.reads_record) reads all of a job's reports.
--
-- RESTRICTIVE policies, so they narrow the existing member policies rather than
-- replace them; the photo rule is folded into the existing storage policy.
-- ============================================================================

create or replace function app.incident_readable(p_incident uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.incidents i
     where i.id = p_incident
       and (app.reads_record(i.project_id) or i.reported_by = (select auth.uid()))
  )
$$;
grant execute on function app.incident_readable(uuid) to authenticated;

create policy incidents_reads_own_or_record on public.incidents
  as restrictive for select to authenticated
  using (app.reads_record(project_id) or reported_by = (select auth.uid()));

create policy incident_updates_reads_own_or_record on public.incident_updates
  as restrictive for select to authenticated
  using (app.incident_readable(incident_id));

create policy incident_actions_reads_own_or_record on public.incident_actions
  as restrictive for select to authenticated
  using (app.incident_readable(incident_id));

-- Photos live at {project}/incident/{incident_id}/{file}. A folder that is not an incident id
-- reads as nothing rather than raising.
create or replace function app.incident_photo_readable(p_name text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare folder text[] := storage.foldername(p_name);
declare incident uuid;
begin
  if app.reads_record(app.storage_project_id(p_name)) then return true; end if;
  begin
    incident := folder[3]::uuid;
  exception when others then
    return false;
  end;
  return app.incident_readable(incident);
end; $$;
grant execute on function app.incident_photo_readable(text) to authenticated;

drop policy if exists "record media reads by role" on storage.objects;
create policy "record media reads by role" on storage.objects
  as restrictive
  for select to authenticated
  using (
    case
      when bucket_id in ('entry-audio', 'exports')
        then app.reads_record(app.storage_project_id(name))
      when bucket_id = 'entry-photos'
        then case
               when (storage.foldername(name))[2] = 'incident' then app.incident_photo_readable(name)
               else app.reads_record(app.storage_project_id(name))
             end
      else true
    end
  );
