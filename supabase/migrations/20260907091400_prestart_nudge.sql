-- The morning prestart nudge keeps its own "already told them today" mark,
-- so it never steals the knock-off reminder's.
alter table public.push_subscriptions
  add column if not exists last_prestart_notified_on date;

-- The library keeps only talks worth an hour of the crew's time.
delete from public.toolbox_library where length(summary) < 200;
