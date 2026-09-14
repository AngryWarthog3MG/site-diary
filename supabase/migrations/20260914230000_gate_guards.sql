-- ============================================================================
-- The gate, after review (Codex pass 19):
--   * a self-signed sign-in always carries its signature and the moment the
--     rules were accepted — the database refuses one without;
--   * the gate's rate limit is decided inside one transaction under a lock,
--     so two hundred requests at once cannot all see "fewer than sixty".
-- ============================================================================

create or replace function app.site_signins_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.person_name := regexp_replace(btrim(new.person_name), '\s+', ' ', 'g');
  new.company := nullif(regexp_replace(btrim(coalesce(new.company, '')), '\s+', ' ', 'g'), '');
  new.contact := nullif(btrim(coalesce(new.contact, '')), '');
  if new.signed_in_by is null and not new.self_signed then
    raise exception 'A sign-in is made by someone: the gate phone, or the visitor themselves.' using errcode = 'check_violation';
  end if;
  if new.self_signed then
    if auth.uid() is not null then
      raise exception 'A self-signed sign-in comes through the gate, not from an account.' using errcode = 'check_violation';
    end if;
    if new.signature_path is null or new.rules_acknowledged_at is null then
      raise exception 'A visitor signs and accepts the site rules; nothing less is a sign-in.' using errcode = 'check_violation';
    end if;
    if split_part(new.signature_path, '/', 1) <> new.project_id::text
       or split_part(new.signature_path, '/', 2) <> 'signin'
       or split_part(new.signature_path, '/', 3) <> new.id::text then
      raise exception 'The visitor''s signature must be stored in this sign-in''s own folder.' using errcode = 'check_violation';
    end if;
  end if;
  new.signed_in_at := now();
  new.signed_out_at := null;
  new.signed_out_on_device_at := null;
  new.signed_out_by := null;
  new.inducted := exists (
    select 1 from public.crew_inductions ci
     where ci.project_id = new.project_id
       and regexp_replace(lower(btrim(ci.person_name)), '\s+', ' ', 'g') = lower(new.person_name)
  );
  if new.signed_in_on_device_at is null
     or new.signed_in_on_device_at < (new.signin_date::timestamp at time zone 'Australia/Perth') - interval '1 day'
     or new.signed_in_on_device_at > (new.signin_date::timestamp at time zone 'Australia/Perth') + interval '2 days' then
    new.signed_in_on_device_at := now();
    new.notes := concat_ws(' · ', new.notes, 'phone clock out of range at sign-in; server time used');
  end if;
  return new;
end;
$$;

-- The gate's own insert: count and write under one per-job lock. Service role only.
create or replace function public.gate_signin(
  p_id uuid, p_project uuid, p_date date, p_name text, p_company text, p_kind text, p_contact text,
  p_signature_path text, p_at timestamptz
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_recent integer;
begin
  if auth.uid() is not null then
    raise exception 'The gate is the server''s.' using errcode = 'insufficient_privilege';
  end if;
  perform pg_advisory_xact_lock(hashtext('gate:' || p_project::text));
  select count(*) into v_recent from public.site_signins
   where project_id = p_project and self_signed and created_at > now() - interval '10 minutes';
  if v_recent >= 60 then
    raise exception 'gate busy' using errcode = 'P0001';
  end if;
  insert into public.site_signins (id, project_id, signin_date, person_name, company, person_kind, contact, self_signed, signature_path, rules_acknowledged_at, signed_in_on_device_at, signed_in_by)
  values (p_id, p_project, p_date, p_name, p_company, p_kind, p_contact, true, p_signature_path, now(), p_at, null);
  return p_id;
end;
$$;
revoke all on function public.gate_signin(uuid, uuid, date, text, text, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.gate_signin(uuid, uuid, date, text, text, text, text, text, timestamptz) to service_role;
