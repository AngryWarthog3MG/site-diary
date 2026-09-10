-- ============================================================================
-- Codex pass 9.
--
-- 1. Whether a person was inducted is a fact about the moment they signed on,
--    not about the day the PDF was printed. It is stored on the sign-on.
-- 2. The ticket check moves into the database. The screen still explains;
--    the database refuses a signature from an operator whose recorded tickets
--    do not cover the machine. Nothing recorded is still allowed — an empty
--    list is not a missing ticket — and the mapping mirrors
--    src/lib/crew/tickets.ts REQUIRED_TICKETS; change both.
-- ============================================================================

alter table public.prestart_attendees add column if not exists inducted boolean;
comment on column public.prestart_attendees.inducted is
  'Whether the person was inducted on this job when they signed on. Null for sign-ons before this was recorded.';

create or replace function app.plant_required_tickets(p_kind text)
returns text[]
language sql
immutable
as $$
  select case p_kind
    when 'excavator'   then array['excavator']
    when 'roller'      then array['roller']
    when 'vac_truck'   then array['mr_licence', 'hr_licence', 'hc_licence']
    when 'truck'       then array['c_licence', 'mr_licence', 'hr_licence', 'hc_licence']
    when 'vac_trailer' then array['c_licence', 'mr_licence', 'hr_licence', 'hc_licence']
    else array[]::text[]
  end
$$;

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
