-- ============================================================================
-- Signing on to the prestart from your own phone (README R141).
--
-- "The supervisor will do the prestart, then all ops log into their phone and
-- sign on, rather than passing the phone to each person." The same shape as
-- signing on to a SWMS as yourself (R89): any member of the job puts their
-- OWN name to the day's OPEN prestart, once; the database decides whose name
-- is whose, not the screen. The supervisor finishes it last — a finished
-- prestart is a record, and nothing joins it (unchanged).
-- ============================================================================

create or replace function app.prestart_project(p_prestart uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select project_id from public.prestarts where id = p_prestart;
$$;
grant execute on function app.prestart_project(uuid) to authenticated;

-- A member of the job, while the prestart is open — the page they read, and the folder their signature goes in.
create or replace function app.is_prestart_member_open(p_prestart uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.prestarts s
     where s.id = p_prestart and s.completed_at is null and app.is_project_member(s.project_id)
  );
$$;
grant execute on function app.is_prestart_member_open(uuid) to authenticated;

-- Signing on as yourself: the prestart is open, you are on its job, the name is your own, and you have not signed it yet.
create or replace function app.can_sign_own_prestart(p_prestart uuid, p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.prestarts s
      join public.profiles pr on pr.id = (select auth.uid())
     where s.id = p_prestart
       and s.completed_at is null
       and app.is_project_member(s.project_id)
       and pr.full_name is not null
       and lower(regexp_replace(btrim(pr.full_name), '\s+', ' ', 'g'))
         = lower(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'))
       and not exists (
         select 1 from public.prestart_attendees a
          where a.prestart_id = s.id
            and lower(regexp_replace(btrim(a.attendee_name), '\s+', ' ', 'g'))
              = lower(regexp_replace(btrim(pr.full_name), '\s+', ' ', 'g')))
  );
$$;
grant execute on function app.can_sign_own_prestart(uuid, text) to authenticated;

drop policy if exists prestart_attendees_insert_open on public.prestart_attendees;
create policy prestart_attendees_insert_open on public.prestart_attendees
  for insert to authenticated
  with check (app.can_write_prestart(prestart_id) or app.can_sign_own_prestart(prestart_id, attendee_name));

-- Reads: an OPEN prestart is every member's to read — it is the briefing for their day; finished ones keep the record
-- lock. Your own sign-on is yours to see; the rest of the attendance follows the record.
drop policy if exists prestarts_reads_record on public.prestarts;
create policy prestarts_reads_record on public.prestarts as restrictive for select to authenticated
  using (app.reads_record(project_id) or (completed_at is null and app.is_project_member(project_id)));

drop policy if exists prestart_attendees_reads_record on public.prestart_attendees;
create policy prestart_attendees_reads_record on public.prestart_attendees as restrictive for select to authenticated
  using (
    exists (select 1 from public.prestarts s where s.id = prestart_id and app.reads_record(s.project_id))
    or (app.is_prestart_member_open(prestart_id)
        and lower(regexp_replace(btrim(attendee_name), '\s+', ' ', 'g'))
          = lower(regexp_replace(btrim(coalesce((select pr.full_name from public.profiles pr where pr.id = (select auth.uid())), '')), '\s+', ' ', 'g')))
  );

-- The signature file: whoever runs the prestart, or any member while it is open, into the prestart's own folder.
drop policy if exists "prestart signatures writable while open" on storage.objects;
create policy "prestart signatures writable while open" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'entry-photos'
    and (storage.foldername(name))[2] = 'prestart'
    and (app.can_write_prestart(((storage.foldername(name))[3])::uuid)
         or app.is_prestart_member_open(((storage.foldername(name))[3])::uuid))
    and (storage.foldername(name))[1] = app.prestart_project(((storage.foldername(name))[3])::uuid)::text
  );
