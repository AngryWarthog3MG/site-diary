-- ============================================================================
-- 20260907090500_harvest_fix.sql
-- Two fixes the sandbox drill caught before production could:
--   1. The category literal needed casting to keyword_category.
--   2. Far more important: the harvest ran INSIDE the signing statement, so
--      its failure blocked the signature itself. Vocabulary learning is a
--      nice-to-have riding on the record's most important moment — it now
--      swallows its own failures with a warning. A signature must never be
--      hostage to a keyword.
-- ============================================================================

create or replace function app.harvest_entry_vocabulary()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    insert into public.project_keywords (project_id, term, category)
    select distinct new.project_id, t.term, t.category::public.keyword_category
      from (
        select btrim(l.person_name) as term, 'person' as category
          from public.labour l where l.entry_id = new.id
        union
        select btrim(p.item), 'plant'
          from public.plant p where p.entry_id = new.id
        union
        select btrim(p.supplier), 'supplier'
          from public.plant p where p.entry_id = new.id and p.supplier is not null
        union
        select btrim(po.supplier), 'supplier'
          from public.pours po where po.entry_id = new.id and po.supplier is not null
        union
        select btrim(l.area), 'area'
          from public.labour l where l.entry_id = new.id and l.area is not null
        union
        select btrim(w.area), 'area'
          from public.work_items w where w.entry_id = new.id and w.area is not null
        union
        select btrim(q.area), 'area'
          from public.quantities q where q.entry_id = new.id and q.area is not null
      ) t
     where t.term is not null
       and length(t.term) between 2 and 60
    on conflict (project_id, term) do nothing;
  exception when others then
    raise warning 'vocabulary harvest failed for entry %: %', new.id, sqlerrm;
  end;

  return null;
end;
$$;
