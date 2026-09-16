-- ============================================================================
-- A person's name, not their email address, goes on the sheets.
--
-- Sheets print profiles.full_name and fall back to the email only when it is
-- blank. The app now asks anyone without a name for it before they reach any
-- screen (requireUser → /name), and an admin can set a member's name. This
-- constraint is the database half: a name is a name — not blank, not an email
-- address, not an essay. Every existing row passes (checked before applying).
-- ============================================================================

alter table public.profiles
  add constraint profiles_full_name_is_a_name check (
    full_name is null
    or (length(btrim(full_name)) between 1 and 80 and position('@' in full_name) = 0)
  );
