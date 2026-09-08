-- A prestart can be talked through instead of typed. The model splits what
-- was said into the form's fields for the supervisor to check and edit; the
-- words themselves are kept here so a wrong split can always be traced back
-- to what was actually said. Checklist ticks are never filled from speech.
alter table public.prestarts add column dictation text;
comment on column public.prestarts.dictation is
  'Raw transcript of the spoken briefing that filled this prestart, if it was dictated. Provenance for the fields; never printed.';
