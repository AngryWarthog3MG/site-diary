-- ============================================================================
-- 20260902090100_site_policy.sql
-- Site policy changes, decided by the owner on 2026-08-27:
--
--   * A variation photo is optional. It remains on the review screen as an
--     option, but it no longer blocks signing — in practice the photo often
--     lives in another system, and an unsigned diary is worse evidence than a
--     signed one without a photo. The VR reference stays mandatory: that is
--     what makes the variation claimable at all.
--
-- (The other half of the same decision — a standard 8-hour day from 07:00
-- filled in when hours are not stated — lives in the application, where the
-- supervisor still confirms it at signing.)
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
  'Returns the blocking gaps that prevent signing. A variation photo is deliberately not one of them (owner decision, 2026-08-27); the VR reference still is.';
