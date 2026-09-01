-- ============================================================================
-- 20260907090400_vocabulary_and_verify.sql
-- Two closing loops:
--   1. Signing teaches the project its own vocabulary — every confirmed name,
--      machine, area and supplier feeds the keyword list that steers
--      transcription and extraction, so the app hears THIS site better every
--      week it is used.
--   2. A public verification door: anyone holding a docket can check its
--      serial and hash against the record, no account required, and learn
--      nothing but whether the document is genuine.
-- ============================================================================

create or replace function app.harvest_entry_vocabulary()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.project_keywords (project_id, term, category)
  select distinct new.project_id, t.term, t.category
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

  return null;
end;
$$;

create trigger entries_harvest_vocabulary
  after update of status on public.entries
  for each row
  when (old.status = 'draft' and new.status = 'signed')
  execute function app.harvest_entry_vocabulary();

comment on function app.harvest_entry_vocabulary is
  'On signing, confirmed names/plant/areas/suppliers join project_keywords (idempotent), improving transcription and extraction for every later entry.';

-- ---------------------------------------------------------------------------
-- Public verification. Input: the serial and hash printed on every docket.
-- Output: booleans and the signing instant — nothing of the record itself.
-- ---------------------------------------------------------------------------
create or replace function public.verify_entry(p_entry_no text, p_hash text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_entry     public.entries%rowtype;
  v_hash      text := lower(regexp_replace(coalesce(p_hash, ''), '[^0-9a-fA-F]', '', 'g'));
  v_intact    boolean;
  v_superseded_by text;
begin
  select e.* into v_entry
    from public.entries e
   where e.entry_no = btrim(coalesce(p_entry_no, ''))
     and e.status = 'signed';

  if v_entry.id is null then
    return jsonb_build_object('found', false);
  end if;

  v_intact := app.verify_entry_hash(v_entry.id);
  select s.entry_no into v_superseded_by
    from public.entries s
   where s.supersedes_entry_id = v_entry.id and s.status = 'signed';

  return jsonb_build_object(
    'found', true,
    'hash_matches', lower(v_entry.content_hash) = v_hash,
    'record_intact', v_intact,
    'signed_at', v_entry.signed_at,
    'entry_date', v_entry.entry_date,
    'superseded_by', v_superseded_by
  );
end;
$$;

revoke all on function public.verify_entry(text, text) from public;
grant execute on function public.verify_entry(text, text) to anon, authenticated, service_role;

comment on function public.verify_entry is
  'Checks a printed serial and SHA-256 against the signed record. Returns only authenticity facts — found, hash match, live recomputation, signing instant, supersession — never record content.';
