-- ============================================================================
-- 20260907092800_prestart_spec_notes.sql
-- The prestart carries what the specification requires for the day's work.
--
-- "We are mulching Old Brand Drive and trenching the mainline" — the crew
-- need the depth, the cover, the material, the hold points, before they
-- start, not after. The prestart form pulls them from the job's documents
-- (each requirement cited by document, revision and page) and the supervisor
-- keeps the ones that apply. They are stored on the prestart and printed on
-- its PDF: a briefing record of what the crew were told the spec required.
-- Copied verbatim from the documents, never composed — provenance is the
-- citation on each line. Frozen with the rest of the prestart on completion.
-- ============================================================================

alter table public.prestarts
  add column spec_notes jsonb not null default '[]'::jsonb;

comment on column public.prestarts.spec_notes is
  'Array of {task, area, requirements, citations:[{document, revision, page}]} pulled from project_documents for the work planned; what the crew were briefed the spec requires.';
