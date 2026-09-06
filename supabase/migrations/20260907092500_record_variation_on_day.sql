-- ============================================================================
-- 20260907092500_record_variation_on_day.sql
-- A variation that runs all week is recorded on each day, from the register.
--
-- The owner's case: "excavate the mainline was Monday to Thursday". Rather
-- than retyping it on three review screens, the register card offers the open
-- days; picking them writes the same variation into those drafts *as the
-- supervisor*, where it shows on each day's review to be confirmed before the
-- day is signed. Only the author's own unsigned drafts qualify — the same
-- rule as the review screen — and a day already carrying the item is skipped.
-- The row is registered and linked by the insert trigger like any other.
-- ============================================================================

create or replace function public.record_variation_on_day(p_register_id uuid, p_entry_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item  public.variation_register;
  v_entry public.entries;
  v_src   record;
  v_new   uuid;
begin
  select * into v_item from public.variation_register where id = p_register_id;
  if not found or not app.is_project_member(v_item.project_id) then
    raise exception 'That variation is not on one of your projects.';
  end if;
  select * into v_entry from public.entries where id = p_entry_id;
  if not found or v_entry.project_id <> v_item.project_id then
    raise exception 'That day is not on this project.';
  end if;
  if v_entry.status = 'signed' then
    raise exception 'That day is signed; record the variation on a correction instead.';
  end if;
  if v_entry.author_id <> auth.uid() then
    raise exception 'That day belongs to another supervisor.';
  end if;
  if exists (
    select 1 from public.variation_register_links l
      join public.variations v on v.id = l.variation_id
     where l.register_id = p_register_id and v.entry_id = p_entry_id
  ) then
    raise exception 'That day already records this variation.';
  end if;

  -- Wording and reference from the register; who directed it from its
  -- earliest diary mention, if any.
  select v.directed_by, v.directed_at into v_src
    from public.variation_register_links l
    join public.variations v on v.id = l.variation_id
    join public.entries e on e.id = v.entry_id
   where l.register_id = p_register_id
   order by e.entry_date, v.created_at
   limit 1;

  insert into public.variations (entry_id, description, directed_by, directed_at, vr_ref, estimated_cost, source_quote)
  values (p_entry_id, v_item.title, v_src.directed_by, v_src.directed_at, v_item.vr_ref, v_item.estimated_cost, null)
  returning id into v_new;

  insert into public.entry_sections (entry_id, section, state)
  values (p_entry_id, 'variations', 'captured')
  on conflict (entry_id, section) do update set state = 'captured';

  return v_new;
end;
$$;

revoke all on function public.record_variation_on_day(uuid, uuid) from public;
grant execute on function public.record_variation_on_day(uuid, uuid) to authenticated, service_role;
