-- ============================================================================
-- 20260829090100_review.sql
-- What the review screen needs to know, exposed through PostgREST.
--
-- app.entry_blocking_gaps() and app.entry_warnings() live in the private `app`
-- schema, which the client cannot reach. The sign button has to be gated by
-- exactly the rule the database enforces — not a second implementation of it
-- in TypeScript that can drift — so this wraps them for the client.
-- ============================================================================

create or replace function public.entry_review_state(p_entry_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_entry public.entries;
begin
  -- SECURITY DEFINER, so membership is checked explicitly rather than relying
  -- on the RLS that has just been bypassed.
  if not app.can_read_entry(p_entry_id) then
    return null;
  end if;

  select * into v_entry from public.entries e where e.id = p_entry_id;
  if v_entry.id is null then
    return null;
  end if;

  return jsonb_build_object(
    'entry_id',      v_entry.id,
    'status',        v_entry.status,
    'entry_no',      v_entry.entry_no,
    'content_hash',  v_entry.content_hash,
    'signed_at',     v_entry.signed_at,
    'blocking_gaps', to_jsonb(app.entry_blocking_gaps(p_entry_id)),
    'warnings',      to_jsonb(app.entry_warnings(p_entry_id))
  );
  -- Deliberately no pre-signature hash. entry_no is part of the hashed content
  -- and the serial does not exist until signing, so anything shown beforehand
  -- would not be the hash the entry ends up with. The content hash belongs on
  -- the signed screen (§7.4), where it is real.
end;
$$;

comment on function public.entry_review_state(uuid) is
  'Blocking gaps and warnings for an entry. The review screen gates signing on this rather than on its own copy of the rules.';

grant execute on function public.entry_review_state(uuid) to authenticated, service_role;

-- ============================================================================
-- Applying a reviewed entry.
--
-- This is the moment brief non-negotiable #1 is about: the supervisor has been
-- through the proposal, edited it, and is now committing it to the record.
--
-- It runs as one statement so it is one transaction. Rewriting the child rows
-- as a sequence of separate calls would leave a half-wiped draft behind on any
-- failure, and "the network dropped and took half my day's labour with it" is
-- not an acceptable failure mode for a legal record.
--
-- Replace semantics: what the supervisor confirms is the entry, in full.
-- Anything they removed is gone, anything they added is theirs. Items they add
-- by hand carry no source_quote, which is correct — nothing in the transcript
-- says it.
-- ============================================================================

create or replace function public.apply_entry_review(p_entry_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project uuid;
begin
  if not app.can_write_entry(p_entry_id) then
    raise exception 'That entry is not an open draft of yours.'
      using errcode = 'insufficient_privilege';
  end if;

  select e.project_id into v_project from public.entries e where e.id = p_entry_id;

  delete from public.labour         where entry_id = p_entry_id;
  delete from public.plant          where entry_id = p_entry_id;
  delete from public.work_items     where entry_id = p_entry_id;
  delete from public.variations     where entry_id = p_entry_id;
  delete from public.delays         where entry_id = p_entry_id;
  delete from public.pours          where entry_id = p_entry_id;
  delete from public.quantities     where entry_id = p_entry_id;
  delete from public.entry_sections where entry_id = p_entry_id;

  insert into public.labour
    (entry_id, person_name, role, area, hours, overtime_hours, source_quote, confidence)
  select p_entry_id, x.person_name, x.role, x.area, x.hours, x.overtime_hours,
         x.source_quote, x.confidence
    from jsonb_to_recordset(coalesce(p_payload -> 'labour', '[]'::jsonb)) as x(
      person_name text, role text, area text, hours numeric, overtime_hours numeric,
      source_quote text, confidence public.confidence);

  insert into public.plant
    (entry_id, item, hire_type, hours, idle_hours, supplier, source_quote, confidence)
  select p_entry_id, x.item, x.hire_type, x.hours, x.idle_hours, x.supplier,
         x.source_quote, x.confidence
    from jsonb_to_recordset(coalesce(p_payload -> 'plant', '[]'::jsonb)) as x(
      item text, hire_type public.hire_type, hours numeric, idle_hours numeric,
      supplier text, source_quote text, confidence public.confidence);

  insert into public.work_items
    (entry_id, area, description, percent_complete, source_quote, confidence)
  select p_entry_id, x.area, x.description, x.percent_complete, x.source_quote, x.confidence
    from jsonb_to_recordset(coalesce(p_payload -> 'work_items', '[]'::jsonb)) as x(
      area text, description text, percent_complete numeric,
      source_quote text, confidence public.confidence);

  insert into public.variations
    (entry_id, description, directed_by, directed_at, vr_ref, estimated_cost,
     photo_urls, source_quote, confidence)
  select p_entry_id, x.description, x.directed_by, x.directed_at, x.vr_ref, x.estimated_cost,
         coalesce(x.photo_urls, '{}'), x.source_quote, x.confidence
    from jsonb_to_recordset(coalesce(p_payload -> 'variations', '[]'::jsonb)) as x(
      description text, directed_by text, directed_at timestamptz, vr_ref text,
      estimated_cost numeric, photo_urls text[], source_quote text,
      confidence public.confidence);

  insert into public.delays
    (entry_id, start_time, end_time, duration_mins, cause, personnel_affected,
     category, source_quote, confidence)
  select p_entry_id, x.start_time, x.end_time, x.duration_mins, x.cause,
         x.personnel_affected, x.category, x.source_quote, x.confidence
    from jsonb_to_recordset(coalesce(p_payload -> 'delays', '[]'::jsonb)) as x(
      start_time time, end_time time, duration_mins integer, cause text,
      personnel_affected integer, category public.delay_category,
      source_quote text, confidence public.confidence);

  insert into public.pours
    (entry_id, location, volume_m3, mix_spec, supplier, docket_nos, start_time,
     finish_time, docket_photo_urls, source_quote, confidence)
  select p_entry_id, x.location, x.volume_m3, x.mix_spec, x.supplier,
         coalesce(x.docket_nos, '{}'), x.start_time, x.finish_time,
         coalesce(x.docket_photo_urls, '{}'), x.source_quote, x.confidence
    from jsonb_to_recordset(coalesce(p_payload -> 'pours', '[]'::jsonb)) as x(
      location text, volume_m3 numeric, mix_spec text, supplier text,
      docket_nos text[], start_time time, finish_time time,
      docket_photo_urls text[], source_quote text, confidence public.confidence);

  insert into public.quantities
    (entry_id, item_type, area, quantity, unit, source_quote, confidence)
  select p_entry_id, x.item_type, x.area, x.quantity, x.unit, x.source_quote, x.confidence
    from jsonb_to_recordset(coalesce(p_payload -> 'quantities', '[]'::jsonb)) as x(
      item_type text, area text, quantity numeric, unit text,
      source_quote text, confidence public.confidence);

  insert into public.entry_sections (entry_id, section, state, note)
  select p_entry_id, x.section, x.state, x.note
    from jsonb_to_recordset(coalesce(p_payload -> 'sections', '[]'::jsonb)) as x(
      section public.entry_section, state public.section_state, note text);

  -- The supervisor's words about what the weather did. The numbers stay BOM's:
  -- this only ever writes observed_impact, and a row that does not exist yet is
  -- opened as 'manual' with no readings, which the BOM route is free to fill in.
  if nullif(btrim(coalesce(p_payload ->> 'weather_impact', '')), '') is not null then
    insert into public.weather (entry_id, source, observed_impact)
    values (p_entry_id, 'manual', p_payload ->> 'weather_impact')
    on conflict (entry_id) do update set observed_impact = excluded.observed_impact;
  else
    update public.weather set observed_impact = null where entry_id = p_entry_id;
  end if;

  return public.entry_review_state(p_entry_id);
end;
$$;

comment on function public.apply_entry_review(uuid, jsonb) is
  'Replaces a draft entry''s child rows with what the supervisor confirmed. One statement, so one transaction.';

grant execute on function public.apply_entry_review(uuid, jsonb) to authenticated, service_role;
