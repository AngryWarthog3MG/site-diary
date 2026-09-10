-- completed_at is when the record reached the database — so the database
-- stamps it. A phone finishing offline and sending later, or a phone with the
-- wrong clock, cannot write a false receipt time; its own clock lives in
-- completed_on_device_at. Codex pass 8.
create or replace function app.stamp_completed_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.completed_at is not null and old.completed_at is null then
    new.completed_at := now();
  end if;
  return new;
end;
$$;

-- Runs before the immutability triggers (alphabetical: "a_" first), so the
-- stamp is what they see.
create trigger a_prestarts_stamp_completed before update on public.prestarts
  for each row execute function app.stamp_completed_at();
create trigger a_toolbox_talks_stamp_completed before update on public.toolbox_talks
  for each row execute function app.stamp_completed_at();
