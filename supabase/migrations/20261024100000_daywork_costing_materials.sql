-- A materials figure on a daywork's costing (README R170).
--
-- Mitchell: "in the dayworks allow me to manually input a figure for the materials used." The signed day records the
-- materials as words — "20 t crushed rock, 4 bags cement" — and nothing in the app prices them: there is no rate card
-- for materials, and there must never be a guess. So the office types the figure, ex GST, on the item's costing row
-- beside the signed day, with what it was for, and the item's amount carries it. The record is untouched; every change
-- is kept; the sheet the head contractor signs never sees it.

alter table public.daywork_costings
  add column materials_amount numeric(12,2) check (materials_amount is null or materials_amount >= 0),
  add column materials_note text;
comment on column public.daywork_costings.materials_amount is
  'The materials on this item as the office costs them, ex GST, typed (README R170): null is no figure, never 0. Added to the item''s amount; never on the record or the sign-off sheet.';

alter table public.daywork_costing_changes
  add column old_materials_amount numeric(12,2),
  add column new_materials_amount numeric(12,2),
  add column new_materials_note text;

create or replace function app.daywork_costings_log_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.labour is distinct from old.labour or new.plant is distinct from old.plant
     or new.excluded is distinct from old.excluded or new.excluded_reason is distinct from old.excluded_reason
     or new.materials_amount is distinct from old.materials_amount or new.materials_note is distinct from old.materials_note then
    insert into public.daywork_costing_changes (costing_id, project_id, old_labour, new_labour, old_plant, new_plant, old_excluded, new_excluded, new_excluded_reason, old_materials_amount, new_materials_amount, new_materials_note, changed_by)
    values (new.id, new.project_id, old.labour, new.labour, old.plant, new.plant, old.excluded, new.excluded, new.excluded_reason, old.materials_amount, new.materials_amount, new.materials_note, auth.uid());
  end if;
  return new;
end;
$$;
