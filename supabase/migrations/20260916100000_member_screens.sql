-- Per-person access on a job. `screens` names exactly the screens this member may open;
-- null means the role's own list (src/lib/roles.ts `canSee`). Set by a project admin from
-- the Members screen with a tick box per section — Mitchell: "i need to be able to change
-- what he has access to at all times using a tick box to each task". The role still decides
-- what the person may DO (write the diary, run a talk, progress an order); this decides
-- which doors open. The existing update policy already limits changes to project admins.
alter table public.project_members add column if not exists screens text[] null;
comment on column public.project_members.screens is
  'Exactly the screens this member may open on this job; null = the role''s default list. App-level gate (middleware, pages, id-addressed APIs); table policies stay by role.';
