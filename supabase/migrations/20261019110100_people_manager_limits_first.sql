-- The people-manager's limits speak before the money-grant check does (README R150): triggers fire by name, and
-- "needs your two-factor code" is the wrong answer to a PM trying to make an admin — the right one is that only an
-- admin does that.
drop trigger if exists project_members_people_manager_limits on public.project_members;
create trigger a_people_manager_limits before insert or update or delete on public.project_members
  for each row execute function app.people_manager_limits();
