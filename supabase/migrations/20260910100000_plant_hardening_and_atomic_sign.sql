-- ============================================================================
-- Codex pass 6, the parts the database owns.
--
-- 1. A plant prestart is never born signed, cannot be completed by hand, and
--    is completed only by a signature over a real set of answered checks.
-- 2. A defect raised by a signed inspection keeps what it said; only closing
--    it is allowed afterwards.
-- 3. Signing a diary entry is one transaction: the payload the supervisor is
--    looking at is applied and the status moves in the same call, so no
--    stale autosave can land between the two.
-- ============================================================================

-- 1. Plant prestarts -----------------------------------------------------------
create or replace function app.plant_prestart_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.completed_at   := null;
  new.signature_path := null;
  return new;
end;
$$;

create trigger plant_prestarts_born_open
  before insert on public.plant_prestarts
  for each row execute function app.plant_prestart_before_insert();

create or replace function app.plant_prestart_before_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_check jsonb;
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

  -- Nobody sets completed_at by hand, and a signature once given stays.
  new.completed_at := old.completed_at;
  if old.signature_path is not null then
    new.signature_path := old.signature_path;
  end if;

  if new.signature_path is not null and old.signature_path is null then
    -- The signature is the completion. It has to be over something.
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
    new.completed_at := now();
  end if;
  return new;
end;
$$;

-- 2. Defects of a signed inspection --------------------------------------------
create or replace function app.plant_defect_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_signed boolean;
begin
  select s.completed_at is not null into v_signed
    from public.plant_prestarts s
   where s.id = coalesce(new.prestart_id, old.prestart_id);
  v_signed := coalesce(v_signed, false);

  if tg_op = 'INSERT' then
    if v_signed then
      raise exception 'This inspection is signed; a defect cannot be added to it afterwards.' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if v_signed then
      raise exception 'A defect raised by a signed inspection cannot be deleted.' using errcode = 'check_violation';
    end if;
    return old;
  end if;
  if v_signed and (
       new.project_id is distinct from old.project_id
    or new.plant_id   is distinct from old.plant_id
    or new.prestart_id is distinct from old.prestart_id
    or new.item_key   is distinct from old.item_key
    or new.item_label is distinct from old.item_label
    or new.note       is distinct from old.note
    or new.photo_path is distinct from old.photo_path
    or new.raised_by  is distinct from old.raised_by
    or new.raised_at  is distinct from old.raised_at
  ) then
    raise exception 'A defect raised by a signed inspection keeps what it said; it can only be closed.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger plant_defects_guard
  before insert or update or delete on public.plant_defects
  for each row execute function app.plant_defect_guard();

-- 3. Signing is one transaction -----------------------------------------------
create or replace function public.sign_entry(p_entry_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- apply_entry_review checks app.can_write_entry itself and raises 42501.
  perform public.apply_entry_review(p_entry_id, p_payload);
  if not app.can_write_entry(p_entry_id) then
    raise exception 'not an open draft you can sign' using errcode = 'insufficient_privilege';
  end if;
  -- The immutability trigger does the rest: gaps, serial, signature, hash.
  update public.entries set status = 'signed' where id = p_entry_id;
  return public.entry_review_state(p_entry_id);
end;
$$;

grant execute on function public.sign_entry(uuid, jsonb) to authenticated;
