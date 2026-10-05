-- ============================================================================
-- The client approves dayworks by signing for them, in the app (README R125).
--
-- "Add a section in the day works where the client, Lendlease, has to sign for
-- the day works to be approved." Until now a sign-off was something that
-- happened on paper and was typed up afterwards (R86), and it was kept as two
-- figures — so many items, so many hours — against a period. That cannot answer
-- "is THIS daywork approved?", and a sheet that never came back was nobody's
-- signature at all.
--
-- So a sign-off can now be the signature itself, drawn on the screen by the
-- head contractor's person, and every sign-off keeps the LINES it was given
-- for: the date, the works and the hours of each item, as they read at that
-- moment. A daywork is approved when a sign-off holds its line. A line that
-- changes afterwards no longer matches and is awaiting approval again — which
-- is exactly the case a subcontractor needs told.
--
-- Nothing already recorded changes: the table stays frozen, the old columns
-- keep their meaning, and a sign-off recorded before today simply has no lines.
-- ============================================================================

alter table public.dayworks_signoffs
  add column signed_how          text not null default 'paper' check (signed_how in ('paper', 'on_screen')),
  -- The drawn signature, in bucket 'dayworks-signoffs' as {project_id}/{signoff_id}.png.
  add column signature_path      text,
  -- The words on the screen above the signature: what signing meant.
  add column declaration         text,
  -- When the signature arrived here, and the signing device's own clock beside it.
  add column signed_at           timestamptz,
  add column signed_on_device_at timestamptz,
  -- What was signed for: [{ "date", "works", "hours", "docket", "labour", "plant", "materials" }, …]. Never recomputed.
  add column lines               jsonb check (lines is null or jsonb_typeof(lines) = 'array');

create or replace function app.dayworks_signoffs_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_last date;
  v_device timestamptz;
begin
  new.signed_by_name := regexp_replace(btrim(new.signed_by_name), '\s+', ' ', 'g');
  new.signed_by_position := nullif(regexp_replace(btrim(coalesce(new.signed_by_position, '')), '\s+', ' ', 'g'), '');
  new.recorded_by := coalesce((select auth.uid()), new.recorded_by);
  new.created_at := now();

  if new.lines is not null then
    if jsonb_array_length(new.lines) <> new.items then
      raise exception 'The lines signed for do not add up to the number of items.' using errcode = 'check_violation';
    end if;
    if exists (select 1 from jsonb_array_elements(new.lines) l
                where coalesce(l->>'date', '') !~ '^\d{4}-\d{2}-\d{2}$' or btrim(coalesce(l->>'works', '')) = '') then
      raise exception 'Every line signed for needs its date and its works.' using errcode = 'check_violation';
    end if;
    select max((l->>'date')::date) into v_last from jsonb_array_elements(new.lines) l;
  end if;

  if new.signature_path is not null then
    -- Signed on the screen: the day is the day it was signed, taken from the signing device's clock when that is
    -- believable (a signature kept on a phone with no signal arrives later than it was made), else from ours.
    new.signed_how := 'on_screen';
    new.signed_at := now();
    v_device := new.signed_on_device_at;
    if v_device is null or v_device > now() + interval '5 minutes' or v_device < now() - interval '14 days' then
      v_device := now();
    end if;
    new.signed_on := (v_device at time zone 'Australia/Perth')::date;
    if new.signature_path <> new.project_id::text || '/' || new.id::text || '.png' then
      raise exception 'The signature must be filed under its own job and sign-off.' using errcode = 'check_violation';
    end if;
    if btrim(coalesce(new.declaration, '')) = '' then
      raise exception 'A signature on the screen records the words it was given under.' using errcode = 'check_violation';
    end if;
    if new.lines is null or new.items = 0 then
      raise exception 'There is nothing here to approve.' using errcode = 'check_violation';
    end if;
  else
    new.signed_how := 'paper';
    new.signed_at := null;
    new.signed_on_device_at := null;
    if new.signed_on > app.perth_today() then
      raise exception 'Record it once it has been signed.' using errcode = 'check_violation';
    end if;
  end if;

  -- Nobody signs for work before it is done: against the lines when we have them, the period's end when we do not.
  if v_last is not null then
    if new.signed_on < v_last then
      raise exception 'A sheet cannot be signed before the work it covers was done.' using errcode = 'check_violation';
    end if;
  elsif new.period_to is not null and new.signed_on < new.period_to then
    raise exception 'A sheet cannot be signed before the work it covers was done.' using errcode = 'check_violation';
  end if;
  return new;
end; $$;

-- A drawn signature is a file a sign-off names, exactly as the countersigned sheet is: never removable once it is.
drop policy "dayworks signoffs unreferenced removable" on storage.objects;
create policy "dayworks signoffs unreferenced removable" on storage.objects
  for delete to authenticated
  using (bucket_id = 'dayworks-signoffs'
         and app.can_manage_registers(app.storage_project_id(name))
         and not exists (select 1 from public.dayworks_signoffs s where s.file_path = name or s.signature_path = name));

comment on table public.dayworks_signoffs is
  'A sign-off of dayworks by the head contractor: on paper and recorded afterwards, or signed on the screen. Keeps the lines it was given for; a daywork is approved when a sign-off holds its line. Frozen.';
