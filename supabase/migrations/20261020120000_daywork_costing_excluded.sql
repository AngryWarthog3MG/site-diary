-- An item left out of the claim (README R160).
--
-- Mitchell: "remove 21/09/2026 Ivac truck plus driver excavation of valves". The day is signed and a signed day never
-- changes (non-negotiable 2), so the item is not removed from the record: it stays on the schedule, on the docket and on
-- the sheet the head contractor signs, which say what was expended. What the office may do is leave it OUT OF THE CLAIM:
-- a mark on its costing row, with the reason, so the costed schedule drops it and says so, and the totals never carry
-- it. Reversible, logged, never a deletion.

alter table public.daywork_costings
  add column excluded boolean not null default false,
  add column excluded_reason text;
comment on column public.daywork_costings.excluded is
  'Left out of the claim by the office (README R160): the costed schedule drops the item and says so. The record is untouched.';

alter table public.daywork_costing_changes
  add column old_excluded boolean,
  add column new_excluded boolean,
  add column new_excluded_reason text;

create or replace function app.daywork_costings_log_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.labour is distinct from old.labour or new.plant is distinct from old.plant or new.excluded is distinct from old.excluded then
    insert into public.daywork_costing_changes (costing_id, project_id, old_labour, new_labour, old_plant, new_plant, old_excluded, new_excluded, new_excluded_reason, changed_by)
    values (new.id, new.project_id, old.labour, new.labour, old.plant, new.plant, old.excluded, new.excluded, new.excluded_reason, auth.uid());
  end if;
  return new;
end;
$$;
