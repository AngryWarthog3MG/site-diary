-- ============================================================================
-- Inspections, after review (Codex pass 17):
--   * an open inspection is the business of whoever started it — nobody else
--     rewrites the answers and signs it;
--   * dates are bounded: not in the future, and the phone's completion clock
--     stays within the inspection's day or the server's time is used;
--   * corrective actions attach only to a signed inspection.
-- ============================================================================

create or replace function app.inspections_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.template_name := btrim(new.template_name);
  new.inspector_name := btrim(new.inspector_name);
  new.area := nullif(btrim(coalesce(new.area, '')), '');
  if new.inspection_date > (now() at time zone 'Australia/Perth')::date + 1
     or new.inspection_date < (now() at time zone 'Australia/Perth')::date - 60 then
    raise exception 'The inspection date is not within the last two months; check it.' using errcode = 'check_violation';
  end if;
  new.signature_path := null;
  new.completed_at := null;
  new.completed_on_device_at := null;
  return new;
end;
$$;

create or replace function app.inspections_before_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.completed_at is not null then
    raise exception 'This inspection is signed and frozen.' using errcode = 'check_violation';
  end if;
  if new.project_id is distinct from old.project_id or new.conducted_by is distinct from old.conducted_by
     or new.created_at is distinct from old.created_at or new.template_id is distinct from old.template_id then
    raise exception 'An inspection keeps its job and who started it.' using errcode = 'check_violation';
  end if;
  if new.inspection_date > (now() at time zone 'Australia/Perth')::date + 1
     or new.inspection_date < (now() at time zone 'Australia/Perth')::date - 60 then
    raise exception 'The inspection date is not within the last two months; check it.' using errcode = 'check_violation';
  end if;
  new.completed_at := null;
  if new.signature_path is not null then
    if app.inspection_answered(new.items) = 0 then
      raise exception 'Nothing was checked: no item has an answer.' using errcode = 'check_violation';
    end if;
    if split_part(new.signature_path, '/', 1) <> new.project_id::text
       or split_part(new.signature_path, '/', 2) <> 'inspection'
       or split_part(new.signature_path, '/', 3) <> new.id::text then
      raise exception 'The signature must be stored in this inspection''s own folder.' using errcode = 'check_violation';
    end if;
    new.completed_at := now();
    if new.completed_on_device_at is null
       or new.completed_on_device_at < (new.inspection_date::timestamp at time zone 'Australia/Perth') - interval '1 day'
       or new.completed_on_device_at > (new.inspection_date::timestamp at time zone 'Australia/Perth') + interval '2 days' then
      new.completed_on_device_at := now();
    end if;
  else
    new.completed_on_device_at := null;
  end if;
  return new;
end;
$$;

drop policy if exists inspections_update_open on public.inspections;
create policy inspections_update_own_open on public.inspections
  for update to authenticated
  using (conducted_by = (select auth.uid()) and completed_at is null and app.can_run_talks(project_id))
  with check (conducted_by = (select auth.uid()) and app.can_run_talks(project_id));

create or replace function app.inspection_actions_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.action := btrim(new.action);
  new.owner_name := nullif(btrim(coalesce(new.owner_name, '')), '');
  if tg_op = 'INSERT' then
    if not exists (select 1 from public.inspections i where i.id = new.inspection_id and i.completed_at is not null) then
      raise exception 'Actions attach to a signed inspection.' using errcode = 'check_violation';
    end if;
    new.done_at := null; new.done_by := null; new.done_note := null;
    return new;
  end if;
  if old.done_at is not null then
    raise exception 'A done action is frozen.' using errcode = 'check_violation';
  end if;
  if new.inspection_id is distinct from old.inspection_id or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception 'An action stays on its inspection.' using errcode = 'check_violation';
  end if;
  if new.done_at is not null then
    new.done_at := now();
    new.done_by := coalesce(auth.uid(), new.done_by);
  else
    new.done_by := null; new.done_note := null;
  end if;
  return new;
end;
$$;
