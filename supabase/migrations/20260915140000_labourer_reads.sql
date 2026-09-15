-- ============================================================================
-- 20260915140000_labourer_reads.sql
-- The labourer reads only what their two doors show.
--
-- Every read policy so far says "a member of the project may read"; the
-- labourer is a member, so until now they could read the diary, the
-- registers and the reports by calling the API directly, even though no
-- screen showed them. This adds a RESTRICTIVE read policy — one that must
-- also pass — on every table that belongs to the record, saying "and not as
-- a labourer". The permissive policies stay as they are; a supervisor, PM,
-- admin or leading hand reads exactly what they read yesterday.
--
-- What a labourer keeps: the gate (site_signins), hazards and incidents (the
-- report, its updates and actions), the crew list and inductions (the gate
-- screen's chips), plant names (to say which machine in a report), the
-- weather line, and the account tables the app itself needs.
-- ============================================================================

-- A member of this project whose role reads the record (anyone but a labourer).
create or replace function app.reads_record(p_project uuid)
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
       and pm.role::text <> 'labourer'
  )
$$;
grant execute on function app.reads_record(uuid) to authenticated;

-- The same at organisation level: on some job of this organisation, not as a labourer.
create or replace function app.reads_org_record(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.project_members pm
      join public.projects p on p.id = pm.project_id
     where p.org_id = p_org
       and pm.user_id = (select auth.uid())
       and pm.role::text <> 'labourer'
  )
$$;
grant execute on function app.reads_org_record(uuid) to authenticated;

-- Tables keyed by project.
create policy entries_reads_record on public.entries as restrictive for select to authenticated using (app.reads_record(project_id));
create policy prestarts_reads_record on public.prestarts as restrictive for select to authenticated using (app.reads_record(project_id));
create policy toolbox_talks_reads_record on public.toolbox_talks as restrictive for select to authenticated using (app.reads_record(project_id));
create policy plant_prestarts_reads_record on public.plant_prestarts as restrictive for select to authenticated using (app.reads_record(project_id));
create policy plant_defects_reads_record on public.plant_defects as restrictive for select to authenticated using (app.reads_record(project_id));
create policy swms_reads_record on public.swms as restrictive for select to authenticated using (app.reads_record(project_id));
create policy inspections_reads_record on public.inspections as restrictive for select to authenticated using (app.reads_record(project_id));
create policy permits_reads_record on public.permits as restrictive for select to authenticated using (app.reads_record(project_id));
create policy orders_reads_record on public.orders as restrictive for select to authenticated using (app.reads_record(project_id));
create policy variation_register_reads_record on public.variation_register as restrictive for select to authenticated using (app.reads_record(project_id));
create policy project_documents_reads_record on public.project_documents as restrictive for select to authenticated using (app.reads_record(project_id));
create policy project_keywords_reads_record on public.project_keywords as restrictive for select to authenticated using (app.reads_record(project_id));
create policy gate_tokens_reads_record on public.gate_tokens as restrictive for select to authenticated using (app.reads_record(project_id));
create policy project_subcontractors_reads_record on public.project_subcontractors as restrictive for select to authenticated using (app.reads_record(project_id));

-- The day's own rows, through the entry.
create policy labour_reads_record on public.labour as restrictive for select to authenticated using (exists (select 1 from public.entries e where e.id = entry_id and app.reads_record(e.project_id)));
create policy plant_reads_record on public.plant as restrictive for select to authenticated using (exists (select 1 from public.entries e where e.id = entry_id and app.reads_record(e.project_id)));
create policy work_items_reads_record on public.work_items as restrictive for select to authenticated using (exists (select 1 from public.entries e where e.id = entry_id and app.reads_record(e.project_id)));
create policy quantities_reads_record on public.quantities as restrictive for select to authenticated using (exists (select 1 from public.entries e where e.id = entry_id and app.reads_record(e.project_id)));
create policy variations_reads_record on public.variations as restrictive for select to authenticated using (exists (select 1 from public.entries e where e.id = entry_id and app.reads_record(e.project_id)));
create policy delays_reads_record on public.delays as restrictive for select to authenticated using (exists (select 1 from public.entries e where e.id = entry_id and app.reads_record(e.project_id)));
create policy pours_reads_record on public.pours as restrictive for select to authenticated using (exists (select 1 from public.entries e where e.id = entry_id and app.reads_record(e.project_id)));
create policy dayworks_reads_record on public.dayworks as restrictive for select to authenticated using (exists (select 1 from public.entries e where e.id = entry_id and app.reads_record(e.project_id)));
create policy photos_reads_record on public.photos as restrictive for select to authenticated using (exists (select 1 from public.entries e where e.id = entry_id and app.reads_record(e.project_id)));
create policy weather_reads_record on public.weather as restrictive for select to authenticated using (exists (select 1 from public.entries e where e.id = entry_id and app.reads_record(e.project_id)));
create policy entry_audio_reads_record on public.entry_audio as restrictive for select to authenticated using (exists (select 1 from public.entries e where e.id = entry_id and app.reads_record(e.project_id)));
create policy entry_extractions_reads_record on public.entry_extractions as restrictive for select to authenticated using (exists (select 1 from public.entries e where e.id = entry_id and app.reads_record(e.project_id)));
create policy entry_sections_reads_record on public.entry_sections as restrictive for select to authenticated using (exists (select 1 from public.entries e where e.id = entry_id and app.reads_record(e.project_id)));
create policy entry_signatures_reads_record on public.entry_signatures as restrictive for select to authenticated using (exists (select 1 from public.entries e where e.id = entry_id and app.reads_record(e.project_id)));
create policy entry_text_reads_record on public.entry_text as restrictive for select to authenticated using (exists (select 1 from public.entries e where e.id = entry_id and app.reads_record(e.project_id)));
create policy daywork_dockets_reads_record on public.daywork_dockets as restrictive for select to authenticated
  using (exists (select 1 from public.dayworks dw join public.entries e on e.id = dw.entry_id where dw.id = daywork_id and app.reads_record(e.project_id)));

-- Rows that hang off a record.
create policy prestart_attendees_reads_record on public.prestart_attendees as restrictive for select to authenticated using (exists (select 1 from public.prestarts s where s.id = prestart_id and app.reads_record(s.project_id)));
create policy toolbox_attendees_reads_record on public.toolbox_attendees as restrictive for select to authenticated using (exists (select 1 from public.toolbox_talks t where t.id = talk_id and app.reads_record(t.project_id)));
create policy swms_signons_reads_record on public.swms_signons as restrictive for select to authenticated using (exists (select 1 from public.swms s where s.id = swms_id and app.reads_record(s.project_id)));
create policy inspection_actions_reads_record on public.inspection_actions as restrictive for select to authenticated using (exists (select 1 from public.inspections i where i.id = inspection_id and app.reads_record(i.project_id)));
create policy order_updates_reads_record on public.order_updates as restrictive for select to authenticated using (exists (select 1 from public.orders o where o.id = order_id and app.reads_record(o.project_id)));
create policy variation_register_links_reads_record on public.variation_register_links as restrictive for select to authenticated using (exists (select 1 from public.variation_register r where r.id = register_id and app.reads_record(r.project_id)));
create policy variation_status_events_reads_record on public.variation_status_events as restrictive for select to authenticated using (exists (select 1 from public.variation_register r where r.id = register_id and app.reads_record(r.project_id)));
create policy project_document_chunks_reads_record on public.project_document_chunks as restrictive for select to authenticated using (exists (select 1 from public.project_documents d where d.id = document_id and app.reads_record(d.project_id)));

-- The organisation's paperwork.
create policy crew_tickets_reads_record on public.crew_tickets as restrictive for select to authenticated using (app.reads_org_record(org_id));
create policy subcontractors_reads_record on public.subcontractors as restrictive for select to authenticated using (app.reads_org_record(org_id));
create policy subcontractor_documents_reads_record on public.subcontractor_documents as restrictive for select to authenticated using (app.reads_org_record(app.subcontractor_org(subcontractor_id)));
create policy controlled_documents_reads_record on public.controlled_documents as restrictive for select to authenticated using (app.reads_org_record(org_id));
create policy document_versions_reads_record on public.document_versions as restrictive for select to authenticated using (app.reads_org_record(app.document_org(document_id)));
create policy document_acknowledgements_reads_record on public.document_acknowledgements as restrictive for select to authenticated using (app.reads_org_record(app.version_org(version_id)));
create policy inspection_templates_reads_record on public.inspection_templates as restrictive for select to authenticated using (app.reads_org_record(org_id));
create policy competency_requirements_reads_record on public.competency_requirements as restrictive for select to authenticated using (app.reads_org_record(org_id));
create policy org_competencies_reads_record on public.org_competencies as restrictive for select to authenticated using (app.reads_org_record(org_id));
