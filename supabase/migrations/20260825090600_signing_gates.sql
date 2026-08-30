-- ============================================================================
-- 20260825090600_signing_gates.sql
-- The four blocking gaps from brief §4, enforced in the database as well as
-- on the review screen:
--   * a variation with no vr_ref
--   * a variation with no photo
--   * a pour with no volume_m3
--   * a delay with no start or end time
--
-- The review screen (step 4) is the primary surface for these; this is the
-- backstop that stops an invalid record ever becoming a signed one.
-- ============================================================================

create or replace function app.entry_blocking_gaps(p_entry_id uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(gap order by gap), '{}')
  from (
    select distinct 'variation_missing_vr_ref' as gap
      from public.variations v
     where v.entry_id = p_entry_id
       and (v.vr_ref is null or length(btrim(v.vr_ref)) = 0)
    union
    select distinct 'variation_missing_photo'
      from public.variations v
     where v.entry_id = p_entry_id
       and coalesce(array_length(v.photo_urls, 1), 0) = 0
    union
    select distinct 'pour_missing_volume_m3'
      from public.pours p
     where p.entry_id = p_entry_id
       and p.volume_m3 is null
    union
    select distinct 'delay_missing_times'
      from public.delays d
     where d.entry_id = p_entry_id
       and (d.start_time is null or d.end_time is null)
  ) g;
$$;

comment on function app.entry_blocking_gaps(uuid) is
  'Returns the blocking gaps that prevent signing. Empty array means the entry is signable.';

grant execute on function app.entry_blocking_gaps(uuid) to authenticated, service_role;
