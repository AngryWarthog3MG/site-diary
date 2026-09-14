-- ============================================================================
-- Incidents, after review (Codex pass 16):
--   * a corrective action that is done, or on a closed report, cannot be
--     deleted — by anyone; an undone one only by whoever added it;
--   * notified_at is the server's mark that the office was emailed; no
--     signed-in account can set or clear it;
--   * a report in the future is refused, not quietly re-dated.
-- ============================================================================

create or replace function app.incidents_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtext('incidents:' || new.project_id::text));
  select coalesce(max(seq), 0) + 1 into new.seq from public.incidents where project_id = new.project_id;
  new.description := btrim(new.description);
  new.location := nullif(btrim(coalesce(new.location, '')), '');
  new.reported_at := now();
  new.status := 'open';
  new.closed_at := null;
  new.closed_by := null;
  new.notified_at := null;
  if new.occurred_at > now() + interval '1 hour' then
    raise exception 'The report says it happened in the future; check the time.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create or replace function app.incidents_before_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.project_id is distinct from old.project_id or new.seq is distinct from old.seq
     or new.kind is distinct from old.kind or new.occurred_at is distinct from old.occurred_at
     or new.reported_at is distinct from old.reported_at or new.reported_on_device_at is distinct from old.reported_on_device_at
     or new.location is distinct from old.location or new.description is distinct from old.description
     or new.immediate_actions is distinct from old.immediate_actions or new.people_involved is distinct from old.people_involved
     or new.witnesses is distinct from old.witnesses or new.injured_name is distinct from old.injured_name
     or new.injury_type is distinct from old.injury_type or new.body_part is distinct from old.body_part
     or new.treatment is distinct from old.treatment or new.actual_severity is distinct from old.actual_severity
     or new.potential_severity is distinct from old.potential_severity or new.notifiable is distinct from old.notifiable
     or new.plant is distinct from old.plant or new.photo_urls is distinct from old.photo_urls
     or new.reported_by is distinct from old.reported_by or new.created_at is distinct from old.created_at then
    raise exception 'The report is the first account and does not change; add an update instead.' using errcode = 'check_violation';
  end if;
  -- Only the server (no signed-in account) records that the office was emailed.
  if new.notified_at is distinct from old.notified_at and auth.uid() is not null then
    raise exception 'Whether the office was emailed is recorded by the server, not the phone.' using errcode = 'check_violation';
  end if;
  if old.status = 'closed' then
    if new.status <> 'closed' or new.closed_at is distinct from old.closed_at or new.closed_by is distinct from old.closed_by then
      raise exception 'A closed report is frozen.' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if new.status = 'closed' then
    if exists (select 1 from public.incident_actions a where a.incident_id = old.id and a.done_at is null) then
      raise exception 'A report closes only when every corrective action is done.' using errcode = 'check_violation';
    end if;
    new.closed_at := now();
    new.closed_by := coalesce(auth.uid(), new.closed_by);
  else
    new.closed_at := null;
    new.closed_by := null;
  end if;
  return new;
end;
$$;

create or replace function app.incident_actions_before_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.done_at is not null then
    raise exception 'A done action is part of the record and is not removed.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.incidents i where i.id = old.incident_id and i.status = 'closed') then
    raise exception 'A closed report keeps its actions.' using errcode = 'check_violation';
  end if;
  return old;
end;
$$;
create trigger a_incident_actions_before_delete before delete on public.incident_actions
  for each row execute function app.incident_actions_before_delete();

drop policy if exists incident_actions_write_managers on public.incident_actions;
create policy incident_actions_insert_managers on public.incident_actions
  for insert to authenticated
  with check (created_by = (select auth.uid())
              and exists (select 1 from public.incidents i where i.id = incident_id and app.can_manage_incidents(i.project_id)));
create policy incident_actions_update_managers on public.incident_actions
  for update to authenticated
  using (exists (select 1 from public.incidents i where i.id = incident_id and app.can_manage_incidents(i.project_id)))
  with check (exists (select 1 from public.incidents i where i.id = incident_id and app.can_manage_incidents(i.project_id)));
-- An undone action is removed only by whoever added it.
create policy incident_actions_delete_own_open on public.incident_actions
  for delete to authenticated
  using (created_by = (select auth.uid()) and done_at is null
         and exists (select 1 from public.incidents i where i.id = incident_id and app.can_manage_incidents(i.project_id)));
