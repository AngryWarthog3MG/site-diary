-- ============================================================================
-- 20260907090300_weekly_distribution.sql
-- The weekly report goes to people, on a schedule.
--
-- Per-project distribution list plus a sent-marker so a retried cron cannot
-- double-send a week. Neither column is part of any entry's canonical JSON —
-- project rows are configuration, not record.
-- ============================================================================

alter table public.projects
  add column report_emails text[] not null default '{}',
  add column weekly_report_last_sent date;

comment on column public.projects.report_emails is
  'Weekly report distribution list. Every Friday at Perth knock-off the signed week''s PDF is emailed to these addresses.';
