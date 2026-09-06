-- ============================================================================
-- 20260907092400_variation_register_follow_updates.sql
-- A reference or estimate added to an existing diary row reaches its item.
--
-- Registration (092300) fills a blank reference or estimate when a *new* row
-- mentions the item. The review screen rewrites rows on save, so that covers
-- the app's own path — but a row updated in place (the SQL suite does this,
-- and so would a support fix) left the item behind. Same rule, on update:
-- fill a blank, never overwrite what the register already holds.
-- ============================================================================

create or replace function app.variations_follow_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.variation_register r
     set vr_ref         = coalesce(r.vr_ref, nullif(btrim(coalesce(new.vr_ref, '')), '')),
         estimated_cost = coalesce(r.estimated_cost, new.estimated_cost)
    from public.variation_register_links l
   where l.variation_id = new.id and r.id = l.register_id;
  return null;
end;
$$;

create trigger variations_follow_update
  after update of vr_ref, estimated_cost on public.variations
  for each row execute function app.variations_follow_update();
