-- From the review of R158–R162 (README R163).
--
-- 1. An item left out of the claim says why. Every other void, retirement or cancellation in this schema carries its
--    reason; the exclusion did not, and a change to the reason alone left no trail.
-- 2. An open plant check stays with its job and its machine. The update policy let the operator move their own open
--    check to another job they hold; nothing pinned project_id or plant_id. Pre-existing for talk-runners, closed for all.

alter table public.daywork_costings
  add constraint daywork_costings_excluded_has_reason
  check (not excluded or nullif(btrim(coalesce(excluded_reason, '')), '') is not null);

create or replace function app.daywork_costings_log_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.labour is distinct from old.labour or new.plant is distinct from old.plant
     or new.excluded is distinct from old.excluded or new.excluded_reason is distinct from old.excluded_reason then
    insert into public.daywork_costing_changes (costing_id, project_id, old_labour, new_labour, old_plant, new_plant, old_excluded, new_excluded, new_excluded_reason, changed_by)
    values (new.id, new.project_id, old.labour, new.labour, old.plant, new.plant, old.excluded, new.excluded, new.excluded_reason, auth.uid());
  end if;
  return new;
end;
$$;

-- Same body as 20260910160000 (the ticket rule included), plus the pin.
create or replace function app.plant_prestart_before_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_check jsonb;
  v_kind text;
  v_org uuid;
  v_needs text[];
  v_recorded int;
  v_covered int;
  v_today date;
begin
  if tg_op = 'DELETE' then
    if old.completed_at is not null then
      raise exception 'This plant prestart is signed and cannot be deleted.' using errcode = 'check_violation';
    end if;
    return old;
  end if;
  if old.completed_at is not null then
    raise exception 'This plant prestart is signed and cannot be modified.' using errcode = 'check_violation';
  end if;
  if new.project_id <> old.project_id or new.plant_id <> old.plant_id then
    raise exception 'A plant prestart stays with its job and its machine.' using errcode = 'check_violation';
  end if;

  new.completed_at := old.completed_at;
  if old.signature_path is not null then
    new.signature_path := old.signature_path;
  end if;

  if new.signature_path is not null and old.signature_path is null then
    if jsonb_typeof(new.checks) <> 'array' or jsonb_array_length(new.checks) = 0 then
      raise exception 'A plant prestart cannot be signed with no checks answered.' using errcode = 'check_violation';
    end if;
    for v_check in select * from jsonb_array_elements(new.checks) loop
      if jsonb_typeof(v_check) <> 'object'
         or coalesce(v_check ->> 'key', '') = ''
         or coalesce(v_check ->> 'label', '') = ''
         or coalesce(v_check ->> 'result', '') not in ('ok', 'defect', 'na') then
        raise exception 'Every check needs a key, a label and an answer of ok, defect or na.' using errcode = 'check_violation';
      end if;
    end loop;
    if new.signature_path not like new.project_id::text || '/plant/' || new.id::text || '/%' then
      raise exception 'The signature must be stored under this prestart''s own folder.' using errcode = 'check_violation';
    end if;
    if length(btrim(new.operator_name)) = 0 then
      raise exception 'The operator''s name is required to sign.' using errcode = 'check_violation';
    end if;

    -- The operator's tickets, when any are recorded, must cover the machine.
    select r.kind, p.org_id into v_kind, v_org
      from public.plant_register r join public.projects p on p.id = new.project_id
     where r.id = new.plant_id;
    v_needs := app.plant_required_tickets(coalesce(v_kind, 'other'));
    if cardinality(v_needs) > 0 then
      v_today := (now() at time zone 'Australia/Perth')::date;
      select count(*) into v_recorded
        from public.crew_tickets t
       where t.org_id = v_org and t.active
         and lower(regexp_replace(btrim(t.person_name), '\s+', ' ', 'g')) = lower(regexp_replace(btrim(new.operator_name), '\s+', ' ', 'g'));
      if v_recorded > 0 then
        select count(*) into v_covered
          from public.crew_tickets t
         where t.org_id = v_org and t.active
           and lower(regexp_replace(btrim(t.person_name), '\s+', ' ', 'g')) = lower(regexp_replace(btrim(new.operator_name), '\s+', ' ', 'g'))
           and t.ticket_type = any (v_needs)
           and (t.expires_on is null or t.expires_on >= v_today);
        if v_covered = 0 then
          raise exception 'Ticket check: %''s recorded tickets do not cover this machine (needs %).', new.operator_name, array_to_string(v_needs, ' or ')
            using errcode = 'check_violation';
        end if;
      end if;
    end if;

    new.completed_at := now();
  end if;
  return new;
end;
$$;
