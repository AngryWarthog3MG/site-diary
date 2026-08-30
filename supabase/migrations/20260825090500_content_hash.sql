-- ============================================================================
-- 20260825090500_content_hash.sql
-- Canonical JSON + SHA-256 content hash for an entry (brief §3).
--
-- Determinism notes — the hash must be reproducible a year later:
--   * jsonb normalises object key order, so serialisation is stable.
--   * Arrays are ordered by their own canonical text, so the hash depends on
--     row content, never on surrogate ids or physical row order.
--   * Surrogate keys (id, entry_id) and created_at are excluded: they are
--     storage bookkeeping, not the record.
--   * The signature block (status, signed_at, signed_by, content_hash) is
--     excluded, so the hash stays verifiable against the content at any time.
--   * timezone / datestyle / extra_float_digits are pinned on the function so
--     timestamp and float rendering cannot drift with session settings.
-- ============================================================================

create or replace function app.canonical_entry_json(p_entry public.entries)
returns jsonb
language sql
stable
security definer
set search_path = ''
set timezone = 'UTC'
set datestyle = 'ISO, YMD'
set extra_float_digits = 1
as $$
  select jsonb_build_object(
    'entry_no',            p_entry.entry_no,
    'project_id',          p_entry.project_id,
    'entry_date',          to_char(p_entry.entry_date, 'YYYY-MM-DD'),
    'author_id',           p_entry.author_id,
    'supersedes_entry_id', p_entry.supersedes_entry_id,
    'audio_url',           p_entry.audio_url,
    'transcript_raw',      p_entry.transcript_raw,

    'sections', (
      select coalesce(jsonb_agg(j order by j::text), '[]'::jsonb)
        from (select to_jsonb(s) - 'entry_id' as j
                from public.entry_sections s where s.entry_id = p_entry.id) q
    ),
    'labour', (
      select coalesce(jsonb_agg(j order by j::text), '[]'::jsonb)
        from (select to_jsonb(t) - 'id' - 'entry_id' - 'created_at' as j
                from public.labour t where t.entry_id = p_entry.id) q
    ),
    'plant', (
      select coalesce(jsonb_agg(j order by j::text), '[]'::jsonb)
        from (select to_jsonb(t) - 'id' - 'entry_id' - 'created_at' as j
                from public.plant t where t.entry_id = p_entry.id) q
    ),
    'work_items', (
      select coalesce(jsonb_agg(j order by j::text), '[]'::jsonb)
        from (select to_jsonb(t) - 'id' - 'entry_id' - 'created_at' as j
                from public.work_items t where t.entry_id = p_entry.id) q
    ),
    'variations', (
      select coalesce(jsonb_agg(j order by j::text), '[]'::jsonb)
        from (select to_jsonb(t) - 'id' - 'entry_id' - 'created_at' as j
                from public.variations t where t.entry_id = p_entry.id) q
    ),
    'delays', (
      select coalesce(jsonb_agg(j order by j::text), '[]'::jsonb)
        from (select to_jsonb(t) - 'id' - 'entry_id' - 'created_at' as j
                from public.delays t where t.entry_id = p_entry.id) q
    ),
    'pours', (
      select coalesce(jsonb_agg(j order by j::text), '[]'::jsonb)
        from (select to_jsonb(t) - 'id' - 'entry_id' - 'created_at' as j
                from public.pours t where t.entry_id = p_entry.id) q
    ),
    'quantities', (
      select coalesce(jsonb_agg(j order by j::text), '[]'::jsonb)
        from (select to_jsonb(t) - 'id' - 'entry_id' - 'created_at' as j
                from public.quantities t where t.entry_id = p_entry.id) q
    ),
    'photos', (
      select coalesce(jsonb_agg(j order by j::text), '[]'::jsonb)
        from (select to_jsonb(t) - 'id' - 'entry_id' - 'created_at' as j
                from public.photos t where t.entry_id = p_entry.id) q
    ),
    'weather', (
      select coalesce(
               (select to_jsonb(w) - 'entry_id' - 'created_at'
                  from public.weather w where w.entry_id = p_entry.id),
               'null'::jsonb)
    )
  );
$$;

create or replace function app.entry_content_hash(p_entry public.entries)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select encode(
           sha256(convert_to(app.canonical_entry_json(p_entry)::text, 'UTF8')),
           'hex');
$$;

-- Recompute the hash of a stored entry and compare it to what was signed.
-- Returns null if the entry does not exist or was never signed.
create or replace function app.verify_entry_hash(p_entry_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select e.content_hash is not distinct from app.entry_content_hash(e)
    from public.entries e
   where e.id = p_entry_id
     and e.status = 'signed';
$$;

grant execute on function app.verify_entry_hash(uuid) to authenticated, service_role;
