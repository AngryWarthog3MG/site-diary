-- ============================================================================
-- 20260907090900_superseded_by_signed_only.sql
--
-- A draft correction was deleting a signed day from the record.
--
-- diary.entries excluded any signed entry that something pointed at:
--
--     and not exists (select 1 from public.entries later
--                      where later.supersedes_entry_id = e.id)
--
-- "Something" included an unsigned draft. So the moment a supervisor opened a
-- correction — or the app opened one for them and it was never finished — the
-- signed entry it superseded vanished from diary.entries, and with it from
-- every child view: labour, plant, work_items, variations, delays, pours,
-- quantities, weather. The weekly report, the claims register, the progress
-- chart, the portfolio and Ask all read those views, so a signed day silently
-- stopped existing everywhere a claim would look for it, while its stored PDF
-- sat there intact.
--
-- Found on Curtin: two signed entries hidden by two abandoned drafts, which is
-- why the weekly report for the week of 2026-08-31 read "no signed entries"
-- with KBL-2026-09-01-3 and KBL-2026-09-02 both signed inside it.
--
-- Only signing puts something on the record — that is the whole model — so
-- only a *signed* successor can take a day's place. An unfinished correction
-- is work in progress and displaces nothing.
--
-- View definition only. No data changes, no entry is touched, and the content
-- hash of every signed entry is unaffected.
-- ============================================================================

create or replace view diary.entries with (security_invoker = true) as
select
  e.id            as entry_id,
  e.entry_no,
  e.entry_date,
  e.project_id,
  p.name          as project_name,
  p.code          as project_code,
  o.code          as org_code,
  coalesce(pr.full_name, pr.email) as author_name,
  e.signed_at,
  e.transcript_raw,
  prior.entry_no  as supersedes_entry_no,
  e.notes
from public.entries e
join public.projects p       on p.id = e.project_id
join public.organisations o  on o.id = p.org_id
left join public.profiles pr on pr.id = e.author_id
left join public.entries prior on prior.id = e.supersedes_entry_id
where e.status = 'signed'
  and not exists (
    select 1 from public.entries later
     where later.supersedes_entry_id = e.id
       and later.status = 'signed'
  );

comment on view diary.entries is
  'Signed entries that have not been superseded by another *signed* entry — the current record. Drafts are invisible here on purpose, and an unsigned correction does not displace the entry it supersedes: only signing changes the record.';
