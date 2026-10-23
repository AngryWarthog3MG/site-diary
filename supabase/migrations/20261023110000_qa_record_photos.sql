-- Photographs on an inspection and test record (README R166).
--
-- Mitchell: "not a photo on each question, just photos in general." The engine (R96) kept photographs per item; the
-- record now carries its own list — the photographs of the lot, pour or element as a whole — in its own folder in the
-- record-media bucket, like its signatures. Frozen with the record; a void changes nothing else.

alter table public.qa_records
  add column photo_paths text[] not null default '{}';
comment on column public.qa_records.photo_paths is
  'Photographs of the record as a whole (README R166), each under {project}/qa/{record}/ in entry-photos.';

-- Runs AFTER a_qa_records_before_write (alphabetical), which has already judged the record itself.
create or replace function app.qa_records_photos()
returns trigger language plpgsql set search_path = '' as $$
declare folder text := new.project_id::text || '/qa/' || new.id::text || '/'; p text;
begin
  foreach p in array coalesce(new.photo_paths, '{}') loop
    if position(folder in p) <> 1 then
      raise exception 'A photograph sits in the record''s own folder (%).', folder using errcode = 'check_violation';
    end if;
  end loop;
  if tg_op = 'UPDATE' and new.voided_at is not null and old.voided_at is null and new.photo_paths is distinct from old.photo_paths then
    raise exception 'Void it as it stands; nothing else changes with a void.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger b_qa_records_photos before insert or update on public.qa_records
  for each row execute function app.qa_records_photos();
