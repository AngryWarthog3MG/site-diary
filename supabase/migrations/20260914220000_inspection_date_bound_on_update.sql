-- The update path kept the two-month bound after the insert path moved to a
-- year; an inspection entered late with its true date could be saved but not
-- signed. One bound, both paths.
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
     or new.inspection_date < (now() at time zone 'Australia/Perth')::date - 400 then
    raise exception 'The inspection date is not within the last year; check it.' using errcode = 'check_violation';
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
