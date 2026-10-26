-- Progress photos from the crew, feeding the day (README R172).
--
-- Mitchell: "Allow Evan Burke to upload progress daily photos too." Evan is a leading hand. The day's photographs are
-- rows on the entry, written by whoever may write the draft — and that is the authoring roles alone
-- (app.can_author_entries: supervisor, admin, pm), on every path: the entries table, the child tables, the bucket.
-- Opening that to a leading hand would open the whole day to them, and a photo taken at 7 am has no draft to land on
-- anyway. So the crew's photographs have a home of their own, beside the day, the way the gate's sign-ins have:
-- `day_photos` — one row per photograph, by job and the day it was taken, written by anyone who runs the site
-- (app.can_run_talks: supervisor, pm, admin, leading hand), never changed or deleted by a user. The review screen reads
-- them for its date and puts each on the draft once; from there they are the day's photographs as ever — confirmed by
-- the supervisor at signing, on the docket, in the hash. Nothing is on the record until the supervisor saves or signs.

create table public.day_photos (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid not null references public.projects (id) on delete cascade,
  taken_on           date not null,
  -- {project}/day/{taken_on}/{file} in entry-photos: the folder is the job's and the day's, not an entry's.
  url                text not null check (length(btrim(url)) > 0),
  caption            text,
  taken_at           timestamptz,
  added_by           uuid not null default auth.uid() references auth.users (id),
  added_on_device_at timestamptz,
  created_at         timestamptz not null default now()
);
comment on table public.day_photos is
  'Progress photographs taken by the crew (README R172): by job and day, each in {project}/day/{date}/ of entry-photos; the review screen puts each on the day''s draft once. Never edited or deleted by a user.';
create index day_photos_project_day on public.day_photos (project_id, taken_on);

create or replace function app.day_photos_before_insert()
returns trigger language plpgsql set search_path = '' as $$
begin
  if position(new.project_id::text || '/day/' || new.taken_on::text || '/' in new.url) <> 1 then
    raise exception 'A day photo sits in its job''s folder for that day.' using errcode = 'check_violation';
  end if;
  if new.taken_on > (now() at time zone 'Australia/Perth')::date + 1 then
    raise exception 'A day photo is not taken in the future.' using errcode = 'check_violation';
  end if;
  new.caption := nullif(btrim(coalesce(new.caption, '')), '');
  new.added_by := auth.uid();
  return new;
end;
$$;
create trigger a_day_photos_before_insert before insert on public.day_photos for each row execute function app.day_photos_before_insert();
create trigger a_day_photos_no_update before update or delete on public.day_photos for each row execute function app.frozen_row();

alter table public.day_photos enable row level security;
create policy day_photos_select on public.day_photos for select to authenticated using (app.is_project_member(project_id));
create policy day_photos_reads_record on public.day_photos as restrictive for select to authenticated using (app.reads_record(project_id));
create policy day_photos_insert on public.day_photos for insert to authenticated with check (app.can_run_talks(project_id));
grant select, insert on public.day_photos to authenticated;
grant all on public.day_photos to service_role;

-- The file: {project}/day/{date}/{file}, written by whoever runs the site; read like every other photo of the record.
create policy "day photos writable by crew" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'entry-photos'
    and (storage.foldername(name))[2] = 'day'
    and app.can_run_talks(((storage.foldername(name))[1])::uuid)
  );
