-- ============================================================================
-- 20260907091600_remove_curtin_trial_days.sql
-- Remove two signed trial days from Curtin, at the owner's explicit instruction.
--
-- On 2026-09-05 the owner asked for the Curtin record to start from
-- 2026-08-31 and for everything before it to go. Two of the earlier days
-- were signed: KBL_C001_DD_001 (2026-08-27, from the pilot's numbering scheme)
-- and KBL-2026-08-30. Signed entries are immutable by design and the database
-- refuses to delete them; this migration lifts that for exactly these two
-- rows, once, having told the owner that it is irreversible and that serials
-- on the job will now begin at #3. Their stored PDFs are removed alongside.
--
-- Scoped hard: the ids are named, and the statement refuses to run unless
-- they are the rows described above.
-- ============================================================================

begin;

do $$
declare
  n integer;
begin
  select count(*) into n
    from public.entries e join public.projects p on p.id = e.project_id
   where p.code = 'C001' and e.status = 'signed'
     and e.id in ('3bb09d7f-66e5-4d12-8e52-165c52769a5d', 'e9dcb26c-5dc7-467a-9806-63ac1c6ca571')
     and e.entry_no in ('KBL_C001_DD_001', 'KBL-2026-08-30');
  if n <> 2 then
    raise exception 'refusing: expected exactly the two named Curtin trial entries, found %', n;
  end if;
end $$;

alter table public.entries           disable trigger user;
alter table public.labour            disable trigger user;
alter table public.plant             disable trigger user;
alter table public.work_items        disable trigger user;
alter table public.variations        disable trigger user;
alter table public.delays            disable trigger user;
alter table public.pours             disable trigger user;
alter table public.quantities        disable trigger user;
alter table public.dayworks          disable trigger user;
alter table public.photos            disable trigger user;
alter table public.weather           disable trigger user;
alter table public.entry_sections    disable trigger user;
alter table public.entry_audio       disable trigger user;
alter table public.entry_extractions disable trigger user;
alter table public.entry_signatures  disable trigger user;
alter table public.entry_text        disable trigger user;

delete from public.entries
 where id in ('3bb09d7f-66e5-4d12-8e52-165c52769a5d', 'e9dcb26c-5dc7-467a-9806-63ac1c6ca571');

alter table public.entries           enable trigger user;
alter table public.labour            enable trigger user;
alter table public.plant             enable trigger user;
alter table public.work_items        enable trigger user;
alter table public.variations        enable trigger user;
alter table public.delays            enable trigger user;
alter table public.pours             enable trigger user;
alter table public.quantities        enable trigger user;
alter table public.dayworks          enable trigger user;
alter table public.photos            enable trigger user;
alter table public.weather           enable trigger user;
alter table public.entry_sections    enable trigger user;
alter table public.entry_audio       enable trigger user;
alter table public.entry_extractions enable trigger user;
alter table public.entry_signatures  enable trigger user;
alter table public.entry_text        enable trigger user;

commit;
