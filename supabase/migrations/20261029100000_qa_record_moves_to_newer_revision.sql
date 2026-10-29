-- An unsigned QA record may be brought onto a newer issued revision of the same form (README R174).
--
-- Rev C of KBS-QA-SL-001 tidies Rev B — the hold points lose their signature lines, one sign-off instead of
-- seven — and the Old Brand Drive record, in progress on Rev B with nothing signed, should not have to be
-- voided and retyped to print on the tidied sheet. The trigger refused ANY change of template_id; now it
-- allows exactly one: the same company's same form code, a later issued revision, while the record carries
-- no sign-off. Everything else the function does is unchanged (the body is the 20260924100000 one).
create or replace function app.qa_records_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  t record; prev record; v_org uuid; inst record;
  item jsonb; so jsonb; oldso jsonb; rw jsonb; k text;
  item_ids text[]; col_keys text[]; hdr_keys text[]; parties text[]; required text[]; releasers text[]; signed_parties text[] := '{}';
  folder text; gaps integer := 0; all_required boolean; all_release boolean;
begin
  select org_id into v_org from public.projects where id = new.project_id;
  select * into t from public.qa_templates where id = new.template_id;
  if t.id is null or t.org_id <> v_org then raise exception 'The form must be one of this company''s templates.' using errcode = 'check_violation'; end if;
  if t.kind = 'itp' then raise exception 'An ITP is instanced on the job, not recorded; record against its ITRs.' using errcode = 'check_violation'; end if;
  if t.issued_at is null then raise exception 'Revision % of % is not issued yet.', t.revision, t.code using errcode = 'check_violation'; end if;
  if new.itp_instance_id is not null then
    select * into inst from public.qa_itp_instances where id = new.itp_instance_id;
    if inst.id is null or inst.project_id <> new.project_id then raise exception 'The ITP instance must be on this job.' using errcode = 'check_violation'; end if;
  end if;
  folder := new.project_id::text || '/qa/' || new.id::text || '/';
  new.lot_or_element := nullif(regexp_replace(btrim(coalesce(new.lot_or_element, '')), '\s+', ' ', 'g'), '');
  new.activity_no := nullif(btrim(coalesce(new.activity_no, '')), '');
  new.comments := nullif(btrim(coalesce(new.comments, '')), '');

  -- Header: only the keys the template names (when it names any).
  if jsonb_typeof(new.header) <> 'object' then raise exception 'header is an object.' using errcode = 'check_violation'; end if;
  hdr_keys := array(select x->>'key' from jsonb_array_elements(coalesce(t.spec->'header_fields', '[]'::jsonb)) x);
  if coalesce(array_length(hdr_keys, 1), 0) > 0 then
    for k in select jsonb_object_keys(new.header) loop
      if not (k = any(hdr_keys)) then raise exception 'Header field % is not on this form.', k using errcode = 'check_violation'; end if;
    end loop;
  end if;

  -- Items: each names an item of the form, with a state; photos sit in the record's own folder.
  if jsonb_typeof(new.items) <> 'array' then raise exception 'items is an array.' using errcode = 'check_violation'; end if;
  item_ids := array(select i->>'id' from jsonb_array_elements(coalesce(t.spec->'sections', '[]'::jsonb)) sec, jsonb_array_elements(coalesce(sec->'items', '[]'::jsonb)) i);
  for item in select * from jsonb_array_elements(new.items) loop
    if t.kind in ('itr_checklist', 'site_form') and not ((item->>'item_id') = any(item_ids)) then
      raise exception 'Item % is not on this form.', coalesce(item->>'item_id', '?') using errcode = 'check_violation';
    end if;
    if coalesce(item->>'state', '') not in ('ok', 'na', 'gap') then raise exception 'Item % needs a state: ok, na or gap.', item->>'item_id' using errcode = 'check_violation'; end if;
    if item->>'state' = 'gap' then gaps := gaps + 1; end if;
    if item ? 'photo_paths' then
      if jsonb_typeof(item->'photo_paths') <> 'array' then raise exception 'photo_paths is an array.' using errcode = 'check_violation'; end if;
      for k in select jsonb_array_elements_text(item->'photo_paths') loop
        if position(folder in k) <> 1 then raise exception 'A photo sits in the record''s own folder (%).', folder using errcode = 'check_violation'; end if;
      end loop;
    end if;
  end loop;
  new.gap_count := gaps;

  -- Register rows: only the columns the form has (a checklist's sub-register counts).
  if jsonb_typeof(new.rows) <> 'array' then raise exception 'rows is an array.' using errcode = 'check_violation'; end if;
  col_keys := array(select c->>'key' from jsonb_array_elements(coalesce(t.spec->'columns', '[]'::jsonb) || coalesce(t.spec->'sub_register'->'columns', '[]'::jsonb)) c);
  for rw in select * from jsonb_array_elements(new.rows) loop
    if jsonb_typeof(rw) <> 'object' then raise exception 'Each register row is an object.' using errcode = 'check_violation'; end if;
    for k in select jsonb_object_keys(rw) loop
      if not (k = any(col_keys)) then raise exception 'Column % is not on this register.', k using errcode = 'check_violation'; end if;
    end loop;
  end loop;

  -- Sign-offs: a party of the form, a name, a signature in the folder, a time; once made, never changed or removed.
  if jsonb_typeof(new.signoffs) <> 'array' then raise exception 'signoffs is an array.' using errcode = 'check_violation'; end if;
  parties := array(select s->>'party' from jsonb_array_elements(coalesce(t.spec->'signoffs', '[]'::jsonb)) s);
  required := array(select s->>'party' from jsonb_array_elements(coalesce(t.spec->'signoffs', '[]'::jsonb)) s where coalesce((s->>'required')::boolean, false));
  releasers := array(select s->>'party' from jsonb_array_elements(coalesce(t.spec->'signoffs', '[]'::jsonb)) s where coalesce((s->>'is_release')::boolean, false));
  for so in select * from jsonb_array_elements(new.signoffs) loop
    if not ((so->>'party') = any(parties)) then raise exception 'Sign-off party % is not on this form.', coalesce(so->>'party', '?') using errcode = 'check_violation'; end if;
    if length(btrim(coalesce(so->>'signer_name', ''))) = 0 then raise exception 'A sign-off names the signer.' using errcode = 'check_violation'; end if;
    if position(folder in coalesce(so->>'signature_path', '')) <> 1 then raise exception 'A signature sits in the record''s own folder.' using errcode = 'check_violation'; end if;
    if (so->>'signed_at') is null then raise exception 'A sign-off carries its time.' using errcode = 'check_violation'; end if;
    if (so->>'party') = any(signed_parties) then raise exception 'Party % signed twice.', so->>'party' using errcode = 'check_violation'; end if;
    signed_parties := signed_parties || (so->>'party');
  end loop;
  if tg_op = 'UPDATE' then
    for oldso in select * from jsonb_array_elements(old.signoffs) loop
      if not (new.signoffs @> jsonb_build_array(oldso)) then raise exception 'A sign-off once made is never changed or removed.' using errcode = 'check_violation'; end if;
    end loop;
  end if;
  all_required := coalesce(array_length(required, 1), 0) > 0 and required <@ signed_parties;
  all_release := coalesce(array_length(releasers, 1), 0) > 0 and releasers <@ signed_parties and coalesce((t.spec->>'hold_point')::boolean, false);

  if tg_op = 'INSERT' then
    new.created_by := coalesce((select auth.uid()), new.created_by);
    new.created_at := now();
    new.voided_at := null; new.void_reason := null;
    new.completed_at := case when all_required then now() end;
    new.released_at := case when all_release then now() end;
  else
    if new.project_id <> old.project_id or new.created_by is distinct from old.created_by
       or new.created_at <> old.created_at or new.client_created_at <> old.client_created_at then
      raise exception 'A record stays on its job, its form and its author.' using errcode = 'check_violation';
    end if;
    -- The form may move ONLY to a newer issued revision of the same form, and only while nobody has signed
    -- (README R174): the items above were checked against the new revision already. A signed record stays
    -- on the revision it was signed on, whatever is issued after it.
    if new.template_id <> old.template_id then
      select * into prev from public.qa_templates where id = old.template_id;
      if old.signoffs <> '[]'::jsonb or old.completed_at is not null then
        raise exception 'A record with a signature on it stays on the revision it was signed on.' using errcode = 'check_violation';
      end if;
      if prev.org_id <> t.org_id or prev.code <> t.code or t.issued_at <= coalesce(prev.issued_at, t.issued_at) then
        raise exception 'A record moves only to a newer issued revision of the same form (% Rev %).', prev.code, prev.revision using errcode = 'check_violation';
      end if;
    end if;
    if old.voided_at is not null then raise exception 'This record is voided.' using errcode = 'check_violation'; end if;
    if new.voided_at is not null then
      -- Voiding, at any stage: nothing else changes with it.
      if new.header <> old.header or new.items <> old.items or new.rows <> old.rows or new.signoffs <> old.signoffs
         or new.comments is distinct from old.comments or new.lot_or_element is distinct from old.lot_or_element
         or new.activity_no is distinct from old.activity_no or new.itp_instance_id is distinct from old.itp_instance_id
         or new.diary_entry_id is distinct from old.diary_entry_id or new.submitted_at is distinct from old.submitted_at then
        raise exception 'Void it as it stands; nothing else changes with a void.' using errcode = 'check_violation';
      end if;
      new.voided_at := now(); new.void_reason := btrim(new.void_reason);
      new.completed_at := old.completed_at; new.released_at := old.released_at; new.gap_count := old.gap_count;
    else
      if old.completed_at is not null then
        raise exception 'A signed record is frozen; void it and raise a new one.' using errcode = 'check_violation';
      end if;
      new.completed_at := case when all_required then now() end;
      new.released_at := coalesce(old.released_at, case when all_release then now() end);
    end if;
  end if;
  new.updated_at := now();
  return new;
end; $$;
