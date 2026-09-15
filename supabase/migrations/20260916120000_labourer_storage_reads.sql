-- The labourer read lock (20260915140000) closed the record's TABLES; the buckets that hold the
-- record's media were still readable by any project member through Storage directly — a
-- labourer's login could list and download a day's audio, its photos and its signed PDF
-- (Codex pass B, 2026-09-16). One RESTRICTIVE select policy on storage.objects closes that:
-- entry-audio and exports read only by a role that reads the record; entry-photos likewise,
-- except the incident folder, which holds the photos on the hazard reports a labourer may make
-- and read. Every other bucket keeps its own policy. CASE, not OR: Postgres does not promise
-- the order OR's operands are evaluated in, and the path helper must only run on these buckets.
create policy "record media reads by role" on storage.objects
  as restrictive
  for select to authenticated
  using (
    case
      when bucket_id in ('entry-audio', 'exports')
        then app.reads_record(app.storage_project_id(name))
      when bucket_id = 'entry-photos'
        then (storage.foldername(name))[2] = 'incident' or app.reads_record(app.storage_project_id(name))
      else true
    end
  );
