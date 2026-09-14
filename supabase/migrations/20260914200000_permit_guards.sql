-- ============================================================================
-- Permits, after review (Codex pass 18):
--   * a permit issued offline is judged against the phone's issue time, not
--     the moment it reaches the server hours later;
--   * an issued permit's close-out and cancellation fields are frozen until
--     the real transition sets them;
--   * a control counts only if it says what was checked.
-- Also: an inspection may be entered up to a year late with its true date.
-- ============================================================================

create or replace function app.permit_controls_answered(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p) = 'array' and jsonb_array_length(p) > 0
     and not exists (
       select 1 from jsonb_array_elements(p) c
        where jsonb_typeof(c) <> 'object'
           or length(btrim(coalesce(c ->> 'key', ''))) = 0
           or length(btrim(coalesce(c ->> 'label', ''))) = 0
           or coalesce(c ->> 'result', '') not in ('yes', 'na'));
$$;

create or replace function app.permits_before_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_issue_time timestamptz;
begin
  if new.project_id is distinct from old.project_id or new.seq is distinct from old.seq
     or new.issued_by is distinct from old.issued_by or new.created_at is distinct from old.created_at then
    raise exception 'A permit keeps its job, its number and who raised it.' using errcode = 'check_violation';
  end if;
  if old.status in ('closed', 'cancelled') then
    raise exception 'A % permit is frozen.', old.status using errcode = 'check_violation';
  end if;

  if old.status = 'open' then
    if new.status = 'open' then
      new.issuer_signature_path := null; new.holder_signature_path := null; new.issued_at := null;
      new.closeout_checks := null; new.closeout_note := null; new.closeout_signature_path := null; new.cancel_reason := null;
      return new;
    end if;
    if new.status <> 'issued' then
      raise exception 'An open permit is issued or cancelled; it is not closed.' using errcode = 'check_violation';
    end if;
    if not app.permit_controls_answered(new.controls) then
      raise exception 'Every control must be answered yes or not applicable before the permit is issued.' using errcode = 'check_violation';
    end if;
    if not app.permit_path_ok(new.issuer_signature_path, new.project_id, new.id)
       or not app.permit_path_ok(new.holder_signature_path, new.project_id, new.id) then
      raise exception 'The issuer and the holder both sign, into this permit''s own folder.' using errcode = 'check_violation';
    end if;
    -- The issue happened when the phone says it did — a permit signed at 08:00
    -- with no signal and sent at 17:00 was issued at 08:00. The phone's clock
    -- must be near enough to now to be believed.
    v_issue_time := coalesce(new.issued_on_device_at, now());
    if v_issue_time < now() - interval '3 days' or v_issue_time > now() + interval '1 hour' then
      v_issue_time := now();
    end if;
    if new.valid_to < v_issue_time then
      raise exception 'The permit window had already ended when it was issued.' using errcode = 'check_violation';
    end if;
    if new.valid_from < v_issue_time - interval '7 days' or new.valid_from > v_issue_time + interval '7 days' or new.valid_to > new.valid_from + interval '30 days' then
      raise exception 'A permit window starts within a week of issue and runs at most thirty days.' using errcode = 'check_violation';
    end if;
    new.issued_at := now();
    new.issued_on_device_at := v_issue_time;
    new.closeout_checks := null; new.closeout_note := null; new.closeout_signature_path := null; new.cancel_reason := null;
    new.closed_at := null; new.closed_on_device_at := null; new.closed_by := null;
    return new;
  end if;

  -- Issued: frozen but for the close-out or a cancellation.
  if new.kind is distinct from old.kind or new.title is distinct from old.title or new.location is distinct from old.location
     or new.valid_from is distinct from old.valid_from or new.valid_to is distinct from old.valid_to
     or new.swms_id is distinct from old.swms_id or new.plant is distinct from old.plant or new.workers is distinct from old.workers
     or new.controls is distinct from old.controls or new.conditions is distinct from old.conditions
     or new.issuer_name is distinct from old.issuer_name or new.issuer_signature_path is distinct from old.issuer_signature_path
     or new.holder_name is distinct from old.holder_name or new.holder_signature_path is distinct from old.holder_signature_path
     or new.issued_at is distinct from old.issued_at or new.issued_on_device_at is distinct from old.issued_on_device_at then
    raise exception 'An issued permit is frozen; cancel it and raise another.' using errcode = 'check_violation';
  end if;
  if new.status = 'cancelled' then
    if length(btrim(coalesce(new.cancel_reason, ''))) = 0 then
      raise exception 'Say why the permit is cancelled.' using errcode = 'check_violation';
    end if;
    new.closed_at := now(); new.closed_by := coalesce(auth.uid(), new.closed_by);
    new.closeout_checks := null; new.closeout_note := null; new.closeout_signature_path := null; new.closed_on_device_at := null;
    return new;
  end if;
  if new.status = 'closed' then
    if not app.permit_controls_answered(new.closeout_checks) then
      raise exception 'Every close-out check must be answered before the permit is closed.' using errcode = 'check_violation';
    end if;
    if not app.permit_path_ok(new.closeout_signature_path, new.project_id, new.id) then
      raise exception 'The close-out is signed into this permit''s own folder.' using errcode = 'check_violation';
    end if;
    new.closed_at := now();
    new.closed_on_device_at := coalesce(new.closed_on_device_at, now());
    new.closed_by := coalesce(auth.uid(), new.closed_by);
    new.cancel_reason := null;
    return new;
  end if;
  if new.status = 'issued' then
    if new.closeout_checks is distinct from old.closeout_checks or new.closeout_note is distinct from old.closeout_note
       or new.closeout_signature_path is distinct from old.closeout_signature_path or new.cancel_reason is distinct from old.cancel_reason
       or new.closed_at is distinct from old.closed_at or new.closed_by is distinct from old.closed_by
       or new.closed_on_device_at is distinct from old.closed_on_device_at then
      raise exception 'Close-out and cancellation are recorded by closing or cancelling, not by editing.' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  raise exception 'An issued permit does not become %.', new.status using errcode = 'check_violation';
end;
$$;

-- An inspection may be entered late, with its true date, up to a year back.
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
     or new.inspection_date < (now() at time zone 'Australia/Perth')::date - 400 then
    raise exception 'The inspection date is not within the last year; check it.' using errcode = 'check_violation';
  end if;
  new.signature_path := null;
  new.completed_at := null;
  new.completed_on_device_at := null;
  return new;
end;
$$;
