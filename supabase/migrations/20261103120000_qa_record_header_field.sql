-- A header field picked from another form's records (README R182).
--
-- The concrete lot record's "Earthworks lot (ITR-001)" was a text box, and the first one filled in named the FORM
-- (6425-KBS-ITR-001) rather than the lot. A header field may now be of type `record`, naming in `template_code` the
-- company's form whose records on the job it is picked from; the screen offers those records' lots and the sheet
-- prints the lot picked, as the paper did. The template check gains one rule — such a field names its form — and
-- is otherwise the 20260924100000 body. The record's header stays a plain string: nothing else changes.
create or replace function app.qa_template_problems(p_spec jsonb)
returns text[] language plpgsql immutable set search_path = '' as $$
declare
  out_ text[] := '{}';
  kind text := p_spec->>'kind';
  s jsonb; it jsonb; a jsonb; c jsonb; party text; mark text;
  ids text[] := '{}'; keys text[] := '{}'; parties text[];
begin
  if length(btrim(coalesce(p_spec->>'code', ''))) = 0 then out_ := out_ || 'a code'; end if;
  if kind is null or kind not in ('itp', 'itr_checklist', 'itr_register', 'site_form') then out_ := out_ || 'a kind (itp, itr_checklist, itr_register or site_form)'; end if;
  if length(btrim(coalesce(p_spec->>'title', ''))) = 0 then out_ := out_ || 'a title'; end if;
  if length(btrim(coalesce(p_spec->>'revision', ''))) = 0 then out_ := out_ || 'a revision'; end if;
  if jsonb_typeof(p_spec->'signoffs') = 'array' then
    for s in select * from jsonb_array_elements(p_spec->'signoffs') loop
      if length(btrim(coalesce(s->>'party', ''))) = 0 then out_ := out_ || 'every sign-off needs a party'; end if;
      if coalesce((s->>'is_release')::boolean, false) and not coalesce((p_spec->>'hold_point')::boolean, false) then
        out_ := out_ || 'a release sign-off only on a hold point form';
      end if;
    end loop;
  end if;
  if kind = 'itp' then
    parties := array(select jsonb_array_elements_text(coalesce(p_spec->'parties', '[]'::jsonb)));
    if coalesce(array_length(parties, 1), 0) = 0 then out_ := out_ || 'the inspecting parties'; end if;
    if jsonb_typeof(p_spec->'activities') <> 'array' or jsonb_array_length(p_spec->'activities') = 0 then out_ := out_ || 'at least one activity'; end if;
    for a in select * from jsonb_array_elements(coalesce(p_spec->'activities', '[]'::jsonb)) loop
      if length(btrim(coalesce(a->>'no', ''))) = 0 or length(btrim(coalesce(a->>'activity', ''))) = 0 then out_ := out_ || 'every activity numbered and named'; end if;
      if (a->>'no') = any(ids) then out_ := out_ || format('activity %s twice', a->>'no'); end if;
      ids := ids || (a->>'no');
      for party, mark in select key, value from jsonb_each_text(coalesce(a->'inspection', '{}'::jsonb)) loop
        if not (party = any(parties)) then out_ := out_ || format('activity %s inspects for an unknown party (%s)', a->>'no', party); end if;
        if mark <> '' and mark !~ '^(H|W|R)(,\s*(H|W|R))*$' then out_ := out_ || format('activity %s: inspection type %s is not H, W or R', a->>'no', mark); end if;
      end loop;
    end loop;
  elsif kind = 'itr_register' then
    if jsonb_typeof(p_spec->'columns') <> 'array' or jsonb_array_length(p_spec->'columns') = 0 then out_ := out_ || 'at least one column'; end if;
    for c in select * from jsonb_array_elements(coalesce(p_spec->'columns', '[]'::jsonb)) loop
      if length(btrim(coalesce(c->>'key', ''))) = 0 or length(btrim(coalesce(c->>'label', ''))) = 0 then out_ := out_ || 'every column keyed and labelled'; end if;
      if (c->>'key') = any(keys) then out_ := out_ || format('column %s twice', c->>'key'); end if;
      keys := keys || (c->>'key');
    end loop;
  elsif kind in ('itr_checklist', 'site_form') then
    if not exists (select 1 from jsonb_array_elements(coalesce(p_spec->'sections', '[]'::jsonb)) sec, jsonb_array_elements(coalesce(sec->'items', '[]'::jsonb))) then
      out_ := out_ || 'at least one item';
    end if;
    for it in select i from jsonb_array_elements(coalesce(p_spec->'sections', '[]'::jsonb)) sec, jsonb_array_elements(coalesce(sec->'items', '[]'::jsonb)) i loop
      if length(btrim(coalesce(it->>'id', ''))) = 0 or length(btrim(coalesce(it->>'text', ''))) = 0 then out_ := out_ || 'every item numbered and worded'; end if;
      if (it->>'id') = any(ids) then out_ := out_ || format('item %s twice', it->>'id'); end if;
      ids := ids || (it->>'id');
      if it ? 'value_type' and (it->>'value_type') not in ('none', 'text', 'number', 'ref', 'photo') then out_ := out_ || format('item %s: value type %s', it->>'id', it->>'value_type'); end if;
    end loop;
  end if;
  keys := '{}';
  for c in select * from jsonb_array_elements(coalesce(p_spec->'header_fields', '[]'::jsonb)) loop
    if length(btrim(coalesce(c->>'key', ''))) = 0 or length(btrim(coalesce(c->>'label', ''))) = 0 then out_ := out_ || 'every header field keyed and labelled'; end if;
    if (c->>'key') = any(keys) then out_ := out_ || format('header field %s twice', c->>'key'); end if;
    keys := keys || (c->>'key');
    -- A field picked from another form's records names that form (README R182).
    if (c->>'type') = 'record' and length(btrim(coalesce(c->>'template_code', ''))) = 0 then out_ := out_ || format('header field %s names the form it picks from', c->>'key'); end if;
  end loop;
  return array(select distinct unnest(out_));
end; $$;
