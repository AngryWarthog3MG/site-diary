-- ============================================================================
-- 20260907091500_one_open_document_per_day.sql
-- One document per day.
--
-- Before signing there is exactly one editable entry for a project's day;
-- after signing there is the signed one and, if something has to change, at
-- most one open correction beside it. Never two things being edited for the
-- same day at once. The old per-author rule allowed that (two supervisors,
-- two drafts) and allowed a draft correction alongside another author's
-- draft; both read to a supervisor as "two documents for the one day".
--
-- The API says why before the database has to; this is the backstop.
-- ============================================================================

create unique index entries_one_open_per_day
  on public.entries (project_id, entry_date)
  where status <> 'signed';
