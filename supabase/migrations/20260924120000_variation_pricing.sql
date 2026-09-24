-- ============================================================================
-- Pricing a variation from the diary's Variations tab (README R100).
--
-- set_variation_details grows an estimated value: what the office expects the
-- variation to be worth before it is agreed. The agreed value stays what it
-- was — a number a PM settles once — and the day still carries only the
-- register number (owner, 2026-09-11). The old signature goes so the RPC
-- resolves to one function; the tracker's four-argument call still works
-- through the default. And the door narrows to the register keepers, which
-- is who the screens already showed it to.
-- ============================================================================

drop function if exists public.set_variation_details(uuid, text, numeric, text);
create or replace function public.set_variation_details(
  p_register_id    uuid,
  p_vr_ref         text,
  p_agreed_cost    numeric,
  p_notes          text,
  p_estimated_cost numeric default null,
  p_keep_estimate  boolean default true
)
returns public.variation_register
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.variation_register;
begin
  select * into v_row from public.variation_register where id = p_register_id;
  if not found then
    raise exception 'No such variation on the register.' using errcode = 'no_data_found';
  end if;
  if not app.can_manage_registers(v_row.project_id) then
    raise exception 'Only someone who keeps the registers can price a variation.' using errcode = 'insufficient_privilege';
  end if;
  if p_agreed_cost is not null and p_agreed_cost < 0 then
    raise exception 'An agreed value cannot be negative.' using errcode = 'check_violation';
  end if;
  if p_estimated_cost is not null and p_estimated_cost < 0 then
    raise exception 'An estimated value cannot be negative.' using errcode = 'check_violation';
  end if;

  update public.variation_register r
     set vr_ref         = nullif(btrim(coalesce(p_vr_ref, '')), ''),
         agreed_cost    = p_agreed_cost,
         notes          = nullif(btrim(coalesce(p_notes, '')), ''),
         -- The tracker's old call does not mention the estimate: keep it. The tab passes keep = false to set or clear it.
         estimated_cost = case when p_keep_estimate then r.estimated_cost else p_estimated_cost end
   where r.id = p_register_id
   returning * into v_row;
  return v_row;
end;
$$;
revoke all on function public.set_variation_details(uuid, text, numeric, text, numeric, boolean) from public, anon;
grant execute on function public.set_variation_details(uuid, text, numeric, text, numeric, boolean) to authenticated, service_role;
comment on function public.set_variation_details is 'The register keepers set a variation''s client reference, agreed value, notes and — when p_keep_estimate is false — its estimated value. README R100.';
