-- Photographs on a plant prestart (README R193).
--
-- Mitchell: "Can you please add photos to the machine pre-starts? Give an option for people to add photos whilst
-- they're doing the pre-starts for any of the machines or plant." Until now the only photograph a check could carry
-- was one per DEFECT. A machine that is fine has things worth a picture too — the hour meter, the condition it was
-- handed over in, a hired machine's dents on the day it arrived — and that picture is what answers "it was like that
-- when we got it" months later.
--
-- So a prestart carries its own photographs: up to ten, each a file in the prestart's own folder
-- ({project}/plant/{prestart}/…, beside the signature and the defect photos, under the same storage rules — writable
-- while the check is open, by whoever may write the check, the labourer checking their own plant included). They are
-- named on the row in the same update that signs it, and a signed prestart is frozen as it always was, so they are
-- frozen with it. A defect's photograph stays on the defect.

alter table public.plant_prestarts
  add column photo_paths text[] not null default '{}'
    constraint plant_prestarts_photos_at_most_ten check (cardinality(photo_paths) <= 10);
comment on column public.plant_prestarts.photo_paths is
  'Photographs taken during the check (not a defect''s — those sit on plant_defects): files under {project}/plant/{prestart}/ in entry-photos. Named when the check is signed and frozen with it. README R193.';

create or replace function app.plant_prestart_photos_check()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  p text;
  folder text;
begin
  if tg_op = 'UPDATE' and new.photo_paths is not distinct from old.photo_paths then return new; end if;
  folder := new.project_id::text || '/plant/' || new.id::text || '/';
  foreach p in array new.photo_paths loop
    if p is null or position(folder in p) <> 1 or length(p) <= length(folder) then
      raise exception 'A prestart''s photographs are stored under its own folder.' using errcode = 'check_violation';
    end if;
  end loop;
  if (select count(distinct x) from unnest(new.photo_paths) x) <> cardinality(new.photo_paths) then
    raise exception 'A photograph is listed once on a prestart.' using errcode = 'check_violation';
  end if;
  return new;
end; $$;
create trigger plant_prestarts_photos_check before insert or update on public.plant_prestarts
  for each row execute function app.plant_prestart_photos_check();
