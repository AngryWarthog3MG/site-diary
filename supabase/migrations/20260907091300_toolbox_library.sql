-- ============================================================================
-- 20260907091300_toolbox_library.sql
-- A library of toolbox talks, so next week's is set up before anyone asks.
--
-- Every Monday morning the ops cron picks the topic a project has gone
-- longest without and creates the week's talk from it — open, editable, and
-- as changeable as one typed from scratch. Seeded from the talks already
-- written for Curtin. Readable by anyone signed in; kept by the operator.
-- ============================================================================

create table public.toolbox_library (
  id          uuid primary key default gen_random_uuid(),
  topic       text not null unique check (length(btrim(topic)) > 0),
  summary     text not null check (length(btrim(summary)) > 0),
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);

alter table public.toolbox_library enable row level security;
create policy toolbox_library_read on public.toolbox_library
  for select to authenticated using (true);
grant select on public.toolbox_library to authenticated;
grant all on public.toolbox_library to service_role;

insert into public.toolbox_library (topic, summary, sort_order)
select t.topic, t.summary, row_number() over (order by t.talk_date)
from public.toolbox_talks t
join public.projects p on p.id = t.project_id
where p.code = 'C001'
on conflict (topic) do nothing;
