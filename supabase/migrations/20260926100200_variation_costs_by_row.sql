-- Variation costing (README R104), follow-up. A day can record the same variation on more than one row — Curtin's
-- 17/09 carries V-001 twice, 10 h and 6 h, crews on each — so a line brought in from the diary belongs to the ROW,
-- not the day. Keyed by the day, the second row was skipped and six hours fell out of the claim. The day stays on the
-- line (source_entry_id) for its link and for noticing a correction; the row is what makes it once-only.
alter table public.variation_cost_lines
  add column source_variation_id uuid references public.variations (id) on delete set null;

drop index public.variation_cost_lines_one_per_person_day;
drop index public.variation_cost_lines_one_unnamed_day;
create unique index variation_cost_lines_one_per_person_row
  on public.variation_cost_lines (register_id, source_variation_id, lower(person_name))
  where kind = 'labour' and source_variation_id is not null and person_name is not null;
create unique index variation_cost_lines_one_unnamed_row
  on public.variation_cost_lines (register_id, source_variation_id)
  where kind = 'labour' and source_variation_id is not null and person_name is null;

-- The guard, as in 20260926100000 (security definer since 100100), plus: a diary row must record THIS variation.
create or replace function app.variation_cost_lines_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_reg public.variation_register;
  v_register uuid := case when tg_op = 'DELETE' then old.register_id else new.register_id end;
  v_org uuid;
begin
  select * into v_reg from public.variation_register where id = v_register;
  if not found then
    if tg_op = 'DELETE' then return old; end if;
    raise exception 'No such variation on the register.' using errcode = 'foreign_key_violation';
  end if;
  if v_reg.status::text not in ('raised', 'priced') then
    raise exception 'V-% has been %: its build-up is what was claimed. Move it back to Priced to change it — the history keeps both.',
      lpad(v_reg.seq::text, 3, '0'), v_reg.status using errcode = 'check_violation';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if tg_op = 'UPDATE' then
    if new.register_id is distinct from old.register_id then
      raise exception 'A line stays on its variation. Remove it and add it to the other.' using errcode = 'check_violation';
    end if;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.project_id := v_reg.project_id;
  new.description := btrim(regexp_replace(new.description, '\s+', ' ', 'g'));
  new.person_name := nullif(btrim(regexp_replace(coalesce(new.person_name, ''), '\s+', ' ', 'g')), '');
  new.unit := btrim(regexp_replace(new.unit, '\s+', ' ', 'g'));
  new.note := nullif(btrim(coalesce(new.note, '')), '');
  new.updated_at := now();
  if new.work_date is not null and new.work_date > app.perth_today() then
    raise exception 'A day of work cannot be in the future.' using errcode = 'check_violation';
  end if;
  select p.org_id into v_org from public.projects p where p.id = v_reg.project_id;
  if new.plant_id is not null and not exists (select 1 from public.plant_register pr where pr.id = new.plant_id and pr.org_id = v_org) then
    raise exception 'That machine is not on this company''s plant register.' using errcode = 'check_violation';
  end if;
  if new.rate_item_id is not null and not exists (
       select 1 from public.rate_items r where r.id = new.rate_item_id and r.org_id = v_org and (r.project_id is null or r.project_id = v_reg.project_id)) then
    raise exception 'That rate is not on this job''s rate card.' using errcode = 'check_violation';
  end if;
  if new.source_entry_id is not null and not exists (select 1 from public.entries e where e.id = new.source_entry_id and e.project_id = v_reg.project_id) then
    raise exception 'That diary day is not on this job.' using errcode = 'check_violation';
  end if;
  if new.source_variation_id is not null and not exists (
       select 1 from public.variation_register_links l where l.variation_id = new.source_variation_id and l.register_id = new.register_id) then
    raise exception 'That diary row does not record this variation.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
