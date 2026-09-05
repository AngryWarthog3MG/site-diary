-- ============================================================================
-- 20260907091700_known_names.sql
-- The names a job answers to.
--
-- A recording says "Marcus" or "Matty" or "the excavator"; the crew and
-- plant lists know who and what that is. Each entry on those lists can carry
-- the other ways it gets said, so a spoken name lands on the listed one —
-- deterministically, in code, after extraction, with the supervisor still
-- confirming every row at signing.
-- ============================================================================

alter table public.crew       add column if not exists aliases text[] not null default '{}';
alter table public.plant_list add column if not exists aliases text[] not null default '{}';

-- Curtin, from the names the diary has already heard.
update public.crew c set aliases = v.aliases
from (values
  ('Matthew Rodgers', array['Matty', 'Matty Rogers', 'Matt']),
  ('Marcus Hayden',   array['Markus', 'Marcus']),
  ('Hamish Hayden',   array['Hamish']),
  ('Evan Burke',      array['Evan']),
  ('AJ',              array['A J', 'Aj'])
) as v(name, aliases), public.projects p
where p.code = 'C001' and c.project_id = p.id and c.name = v.name;

update public.plant_list l set aliases = v.aliases
from (values
  ('1.8t Excavator', array['excavator', '1.8 ton excavator', '1.8 tonne excavator', '1.8 kilometer excavator', 'the digger', 'digger']),
  ('Vac Trailer',    array['vac trailer', 'trailer']),
  ('Vac Truck',      array['vac truck', 'the vac', 'vac'])
) as v(item, aliases), public.projects p
where p.code = 'C001' and l.project_id = p.id and l.item = v.item;
