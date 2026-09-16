-- ============================================================================
-- Quality: the hold on a non-conforming lot, corrected.
--
-- Two gaps in 20260916190000, found while writing its test suite and fixed here
-- because an applied migration is never edited:
--
-- 1. A lot that failed a check with no NCR raised yet could still be tested. Main
--    Roads WA Spec 201 cl. 201.06.04 is "no further testing is permitted until
--    an NCR has been submitted and Corrective Action has been approved". So a
--    non-conforming lot now refuses a check unless it has at least one NCR and
--    none of them is still open.
--
-- 2. A lot repaired in place could never close. Releasing a hold point needs an
--    open lot, closing needs every hold point released, and nothing moved a
--    non-conforming lot back to open. The hold a non-conformance puts on a lot
--    is lifted by CLOSING the non-conformance (cl. 201.10), so when the last
--    NCR on a lot closes, the lot returns to open — unless it has been replaced
--    by a re-numbered lot, in which case it stays replaced. It is still never
--    reopened by hand.
-- ============================================================================

create or replace function app.lot_checks_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare lot record; pt record;
begin
  select * into lot from public.lots where id = new.lot_id;
  select * into pt from public.itp_points where id = new.itp_point_id;
  if lot is null or pt is null or pt.itp_id <> lot.itp_id then
    raise exception 'A check is against a point of the lot''s own ITP.' using errcode = 'check_violation';
  end if;
  if lot.status in ('conforming', 'replaced') then
    raise exception 'That lot is closed.' using errcode = 'check_violation';
  end if;
  if lot.status = 'nonconforming' and (
       not exists (select 1 from public.ncrs n where n.lot_id = lot.id)
       or exists (select 1 from public.ncrs n where n.lot_id = lot.id and n.status = 'open')) then
    raise exception 'No further testing on this lot until a non-conformance is raised and its corrective action approved.'
      using errcode = 'check_violation';
  end if;
  if new.checked_on > app.perth_today() then
    raise exception 'A check cannot be dated in the future.' using errcode = 'check_violation';
  end if;
  if pt.uses_calibrated_equipment then
    if new.equipment_id is null then
      raise exception 'This point uses calibrated equipment: say which.' using errcode = 'check_violation';
    end if;
    if not app.equipment_calibrated_on(new.equipment_id, new.checked_on) then
      raise exception 'That equipment was not in calibration on the day of the check.' using errcode = 'check_violation';
    end if;
  end if;
  new.checked_by := coalesce((select auth.uid()), new.checked_by);
  new.created_at := clock_timestamp();
  return new;
end; $$;

create or replace function app.lots_before_update()
returns trigger language plpgsql security definer set search_path = '' as $$
declare problems text[];
begin
  if new.project_id is distinct from old.project_id or new.seq is distinct from old.seq or new.itp_id is distinct from old.itp_id
     or new.description is distinct from old.description or new.location is distinct from old.location
     or new.replaces_lot_id is distinct from old.replaces_lot_id or new.opened_by is distinct from old.opened_by
     or new.opened_at is distinct from old.opened_at then
    raise exception 'A lot''s first account does not change.' using errcode = 'check_violation';
  end if;
  if old.status in ('conforming', 'replaced') then
    raise exception 'A closed lot is frozen.' using errcode = 'check_violation';
  end if;
  if new.status = old.status then
    if new.closed_at is distinct from old.closed_at or new.closed_by is distinct from old.closed_by or new.close_note is distinct from old.close_note then
      raise exception 'A lot is closed by moving it to conforming.' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if new.status = 'nonconforming' then
    return new;
  end if;
  if new.status = 'replaced' then
    if not exists (select 1 from public.lots l where l.replaces_lot_id = old.id) then
      raise exception 'A lot is replaced by opening a replacement lot.' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if new.status = 'open' then
    -- Only as the hold lifts: every non-conformance on the lot closed.
    if old.status = 'nonconforming'
       and exists (select 1 from public.ncrs n where n.lot_id = old.id)
       and not exists (select 1 from public.ncrs n where n.lot_id = old.id and n.status <> 'closed') then
      return new;
    end if;
    raise exception 'A lot on hold is released by closing its non-conformance, not by reopening it.' using errcode = 'check_violation';
  end if;
  -- new.status = 'conforming'
  problems := app.lot_close_problems(old.id);
  if array_length(problems, 1) > 0 then
    raise exception 'This lot cannot close: %', array_to_string(problems, ' ') using errcode = 'check_violation';
  end if;
  new.closed_at := now();
  new.closed_by := coalesce((select auth.uid()), new.closed_by);
  return new;
end; $$;

create or replace function app.ncrs_after_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'closed' and old.status <> 'closed' and new.lot_id is not null
     and not exists (select 1 from public.ncrs n where n.lot_id = new.lot_id and n.status <> 'closed') then
    update public.lots set status = 'open' where id = new.lot_id and status = 'nonconforming';
  end if;
  return null;
end; $$;
drop trigger if exists b_ncrs_after_update on public.ncrs;
create trigger b_ncrs_after_update after update on public.ncrs
  for each row execute function app.ncrs_after_update();
