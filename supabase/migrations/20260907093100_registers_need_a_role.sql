-- ============================================================================
-- 20260907093100_registers_need_a_role.sql
-- The leading hand reads; the office writes. Enforced where it counts.
--
-- Codex's review of the last two days found the gap: the leading hand is
-- refused by every page it must not see, but the variation register RPCs,
-- the document table and bucket, and the report exports still took "project
-- member" as enough — reachable with a Supabase client and a session. R12
-- says refused, not hidden. So:
--
--   app.can_manage_registers(project)  supervisor, admin, pm — variation
--                                      status/details/removal, docket numbers
--                                      recorded after signing, document
--                                      uploads and removals
--
-- Reading stays with membership: a leading hand runs the prestart and pulls
-- what the spec requires, so document search and selects remain member-wide
-- by design (README R11, R12).
-- ============================================================================

create or replace function app.can_manage_registers(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.project_members pm
     where pm.project_id = p_project
       and pm.user_id = (select auth.uid())
       and pm.role::text in ('supervisor', 'admin', 'pm')
  )
$$;
comment on function app.can_manage_registers(uuid) is
  'Who may change the registers beside the record (variations, after-signing dockets) and manage job documents: supervisors, admins and PMs. Leading hands read.';

-- Variation register RPCs -----------------------------------------------------
create or replace function public.set_variation_status(p_register_id uuid, p_status public.variation_status, p_note text default null)
returns public.variation_register language plpgsql security definer set search_path = public as $$
declare v_row public.variation_register;
begin
  select * into v_row from public.variation_register where id = p_register_id;
  if not found or not app.can_manage_registers(v_row.project_id) then
    raise exception 'Your role on this job does not include the variation register.';
  end if;
  update public.variation_register r
     set status       = p_status,
         submitted_on = case when p_status = 'submitted' then coalesce(r.submitted_on, current_date) else r.submitted_on end,
         decided_on   = case when p_status in ('approved', 'rejected') then coalesce(r.decided_on, current_date) else r.decided_on end,
         paid_on      = case when p_status = 'paid' then coalesce(r.paid_on, current_date) else r.paid_on end
   where r.id = p_register_id returning * into v_row;
  insert into public.variation_status_events (register_id, status, note, changed_by)
  values (p_register_id, p_status, nullif(btrim(coalesce(p_note, '')), ''), auth.uid());
  return v_row;
end; $$;

create or replace function public.set_variation_details(p_register_id uuid, p_vr_ref text, p_agreed_cost numeric, p_notes text)
returns public.variation_register language plpgsql security definer set search_path = public as $$
declare v_row public.variation_register;
begin
  select * into v_row from public.variation_register where id = p_register_id;
  if not found or not app.can_manage_registers(v_row.project_id) then
    raise exception 'Your role on this job does not include the variation register.';
  end if;
  if p_agreed_cost is not null and p_agreed_cost < 0 then raise exception 'An agreed value cannot be negative.'; end if;
  update public.variation_register r
     set vr_ref = nullif(btrim(coalesce(p_vr_ref, '')), ''), agreed_cost = p_agreed_cost, notes = nullif(btrim(coalesce(p_notes, '')), '')
   where r.id = p_register_id returning * into v_row;
  return v_row;
end; $$;

create or replace function public.remove_variation_item(p_register_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_row public.variation_register;
begin
  select * into v_row from public.variation_register where id = p_register_id;
  if not found or not app.can_manage_registers(v_row.project_id) then
    raise exception 'Your role on this job does not include the variation register.';
  end if;
  if exists (select 1 from public.variation_register_links l join public.variations v on v.id = l.variation_id
              join public.entries e on e.id = v.entry_id where l.register_id = p_register_id and e.status = 'signed') then
    raise exception 'A signed diary records this variation; it cannot be removed from the register.';
  end if;
  delete from public.variation_register where id = p_register_id;
end; $$;

create or replace function public.record_variation_on_day(p_register_id uuid, p_entry_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_item public.variation_register; v_entry public.entries; v_src record; v_new uuid;
begin
  select * into v_item from public.variation_register where id = p_register_id;
  if not found or not app.can_manage_registers(v_item.project_id) then
    raise exception 'Your role on this job does not include the variation register.';
  end if;
  select * into v_entry from public.entries where id = p_entry_id;
  if not found or v_entry.project_id <> v_item.project_id then raise exception 'That day is not on this project.'; end if;
  if v_entry.status = 'signed' then raise exception 'That day is signed; record the variation on a correction instead.'; end if;
  if v_entry.author_id <> auth.uid() then raise exception 'That day belongs to another supervisor.'; end if;
  if exists (select 1 from public.variation_register_links l join public.variations v on v.id = l.variation_id
              where l.register_id = p_register_id and v.entry_id = p_entry_id) then
    raise exception 'That day already records this variation.';
  end if;
  select v.directed_by, v.directed_at into v_src
    from public.variation_register_links l join public.variations v on v.id = l.variation_id join public.entries e on e.id = v.entry_id
   where l.register_id = p_register_id order by e.entry_date, v.created_at limit 1;
  insert into public.variations (entry_id, description, directed_by, directed_at, vr_ref, estimated_cost, source_quote)
  values (p_entry_id, v_item.title, v_src.directed_by, v_src.directed_at, v_item.vr_ref, v_item.estimated_cost, null)
  returning id into v_new;
  insert into public.entry_sections (entry_id, section, state) values (p_entry_id, 'variations', 'captured')
  on conflict (entry_id, section) do update set state = 'captured';
  return v_new;
end; $$;

-- After-signing dockets --------------------------------------------------------
create or replace function public.set_daywork_docket(p_daywork_id uuid, p_docket_ref text, p_note text default null)
returns public.daywork_dockets language plpgsql security definer set search_path = public as $$
declare v_project uuid; v_on_record text; v_row public.daywork_dockets;
begin
  select e.project_id, dw.docket_ref into v_project, v_on_record
    from public.dayworks dw join public.entries e on e.id = dw.entry_id where dw.id = p_daywork_id;
  if not found or not app.can_manage_registers(v_project) then
    raise exception 'Your role on this job does not include dockets.';
  end if;
  if v_on_record is not null and btrim(v_on_record) <> '' then
    raise exception 'That daywork already carries docket % on the signed record.', v_on_record;
  end if;
  if p_docket_ref is null or btrim(p_docket_ref) = '' then raise exception 'A docket number is required.'; end if;
  insert into public.daywork_dockets (daywork_id, docket_ref, note, recorded_by)
  values (p_daywork_id, btrim(p_docket_ref), nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
  on conflict (daywork_id) do update
    set docket_ref = excluded.docket_ref, note = excluded.note, recorded_by = excluded.recorded_by, recorded_at = now(), received_on = current_date
  returning * into v_row;
  return v_row;
end; $$;

-- Documents: members read and search; managing them takes the role ----------
drop policy if exists project_documents_insert_member on public.project_documents;
drop policy if exists project_documents_update_member on public.project_documents;
drop policy if exists project_documents_delete_member on public.project_documents;
create policy project_documents_insert_manager on public.project_documents
  for insert to authenticated with check (app.can_manage_registers(project_id) and uploaded_by = auth.uid());
create policy project_documents_update_manager on public.project_documents
  for update to authenticated using (app.can_manage_registers(project_id)) with check (app.can_manage_registers(project_id));
create policy project_documents_delete_manager on public.project_documents
  for delete to authenticated using (app.can_manage_registers(project_id));

drop policy if exists "project documents writable by project members" on storage.objects;
drop policy if exists "project documents deletable by project members" on storage.objects;
create policy "project documents writable by register managers" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'project-documents' and app.can_manage_registers(app.storage_project_id(name)));
create policy "project documents deletable by register managers" on storage.objects
  for delete to authenticated
  using (bucket_id = 'project-documents' and app.can_manage_registers(app.storage_project_id(name)));
