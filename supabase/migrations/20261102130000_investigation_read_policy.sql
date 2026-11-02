-- ============================================================================
-- README R178, the first live drill: opening an investigation with RETURNING was
-- refused. The select policy asked app.reads_investigation(id), a STABLE
-- function whose lookup runs on the statement's snapshot — and a row inserted by
-- that same statement is not in it, so the RETURNING check saw no row and said no.
-- The policy now reads the row's own columns; the function stays for the child
-- tables, whose parent is already on the file when they are written.
-- ============================================================================
drop policy if exists incident_investigations_select on public.incident_investigations;
create policy incident_investigations_select on public.incident_investigations
  for select to authenticated
  using (app.is_project_member(project_id) and app.reads_record(project_id)
         and (not confidential or app.can_manage_incidents(project_id)));
