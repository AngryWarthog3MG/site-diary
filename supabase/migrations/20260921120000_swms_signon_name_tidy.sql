-- ============================================================================
-- One sign-on per person per version means per PERSON, not per spelling.
--
-- Suite 36 found it: the unique index compares lower(btrim(attendee_name)),
-- which trims the ends and leaves the middle, so "  lab   signer " and
-- "Lab Signer" were two people — while app.can_sign_own_swms collapses the
-- spaces when it matches the name to the profile. Two rules for one name is
-- how a person signs on twice. So the name is tidied on the way in, and the
-- index sees what the policy sees. The supervisor's sign-ons get the same.
-- ============================================================================

create or replace function app.swms_signons_tidy()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.attendee_name := regexp_replace(btrim(new.attendee_name), '\s+', ' ', 'g');
  return new;
end; $$;

-- Before the existing checks (a_ runs after aa_), so they see the tidied name too.
create trigger aa_swms_signons_tidy before insert on public.swms_signons
  for each row execute function app.swms_signons_tidy();
