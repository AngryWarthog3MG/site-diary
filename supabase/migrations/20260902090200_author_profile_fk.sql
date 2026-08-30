-- ============================================================================
-- 20260902090200_author_profile_fk.sql
-- entries.author_id gains a real foreign key to public.profiles.
--
-- The author embed ("who wrote this entry") was being requested through the
-- FK to auth.users, which does not relate entries to profiles at all —
-- PostgREST resolved it only while its schema cache was in a forgiving mood,
-- and the entries register shipped dead. profiles mirrors auth.users row for
-- row (created by trigger on signup), so the constraint is sound, and it gives
-- the embed a genuine relationship to stand on.
-- ============================================================================

alter table public.entries
  add constraint entries_author_profiles_fkey
  foreign key (author_id) references public.profiles (id) on delete restrict;
