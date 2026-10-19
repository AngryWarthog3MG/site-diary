-- The limits must see the caller's role, not the function owner's: `current_user` inside a SECURITY DEFINER function is
-- postgres, so the check "is this the authenticated role" passed everyone through (README R150). Invoker rights; the
-- admin check it calls is definer-safe on its own.
create or replace function app.people_manager_limits()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_project uuid := coalesce(new.project_id, old.project_id);
  v_target  uuid := coalesce(new.user_id, old.user_id);
begin
  if current_user <> 'authenticated' or (select auth.uid()) is null then return coalesce(new, old); end if;
  if app.is_project_admin(v_project) then return coalesce(new, old); end if;
  if v_target = (select auth.uid()) then
    raise exception 'You do not change your own membership — ask an admin.' using errcode = 'insufficient_privilege';
  end if;
  if (tg_op <> 'INSERT' and old.role = 'admin') or (tg_op <> 'DELETE' and new.role = 'admin') then
    raise exception 'Only an admin makes, changes or removes an admin.' using errcode = 'insufficient_privilege';
  end if;
  if tg_op <> 'DELETE' then
    if new.finance is not null and (tg_op = 'INSERT' or new.finance is distinct from old.finance) then
      raise exception 'The money switch is an admin''s to set.' using errcode = 'insufficient_privilege';
    end if;
    if new.manages_people and (tg_op = 'INSERT' or not old.manages_people) then
      raise exception 'Only an admin says who manages people.' using errcode = 'insufficient_privilege';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;
