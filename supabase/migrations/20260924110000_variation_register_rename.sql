-- ============================================================================
-- Renaming a variation on the register (README R98).
--
-- A register entry is born from the first diary row that names its number:
-- its title is that day's description as the supervisor said it. That is the
-- right seed and often the wrong name for the register — "vac trailer
-- trenching along the west fence" becomes "V-003 West fence trenching" once
-- the office has the claim in hand. The diary rows are the signed record and
-- never change; the register's title and the client's reference are the
-- office's to keep. Status still moves only through set_variation_status.
-- ============================================================================

create or replace function public.update_variation_register(p_register_id uuid, p_title text, p_vr_ref text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_project uuid;
  v_title text := regexp_replace(btrim(coalesce(p_title, '')), '\s+', ' ', 'g');
  v_ref text := nullif(regexp_replace(btrim(coalesce(p_vr_ref, '')), '\s+', ' ', 'g'), '');
begin
  select project_id into v_project from public.variation_register where id = p_register_id;
  if v_project is null then
    raise exception 'No such variation on the register.' using errcode = 'no_data_found';
  end if;
  if not app.can_manage_registers(v_project) then
    raise exception 'Only someone who keeps the registers can rename a variation.' using errcode = 'insufficient_privilege';
  end if;
  if length(v_title) = 0 then
    raise exception 'A variation needs a name.' using errcode = 'check_violation';
  end if;
  update public.variation_register set title = v_title, vr_ref = v_ref where id = p_register_id;
end; $$;
revoke all on function public.update_variation_register(uuid, text, text) from public, anon;
grant execute on function public.update_variation_register(uuid, text, text) to authenticated, service_role;
comment on function public.update_variation_register is 'Rename a variation on the register and set the client''s reference. Register keepers only; the diary rows behind it never change. README R98.';
