-- ============================================================================
-- SWMS, after review (Codex pass 15):
--   * a draft cannot be re-pointed at another job or another SWMS once made;
--   * a revision is put into use only if the version it revises is still in
--     use on the same job — a retired or already-superseded base refuses, so
--     two drafts of v1 cannot both become v2 in use, and a revision of
--     finished work cannot quietly become the current SWMS;
--   * created_at and archived_at are as frozen as the content;
--   * a signature is written only under the SWMS's own project folder.
-- ============================================================================

create or replace function app.swms_before_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_problems text[];
begin
  new.updated_at := now();
  if new.created_at is distinct from old.created_at
     or new.created_by is distinct from old.created_by
     or new.project_id is distinct from old.project_id
     or new.supersedes_id is distinct from old.supersedes_id
     or new.version is distinct from old.version then
    raise exception 'A SWMS keeps its job, its lineage and its birth.' using errcode = 'check_violation';
  end if;

  if old.status = 'draft' then
    if new.status = 'draft' then
      new.title := btrim(new.title);
      new.activated_at := null; new.activated_by := null; new.archived_at := null;
      return new;
    end if;
    if new.status <> 'active' then
      raise exception 'A draft is put into use or deleted; it is not archived.' using errcode = 'check_violation';
    end if;
    v_problems := app.swms_problems(new);
    if coalesce(array_length(v_problems, 1), 0) > 0 then
      raise exception 'Not ready to be worked to: %', array_to_string(v_problems, '; ') using errcode = 'check_violation';
    end if;
    new.title := btrim(new.title);
    new.activated_at := now();
    new.activated_by := coalesce(auth.uid(), new.created_by);
    new.archived_at := null;
    if new.supersedes_id is not null then
      update public.swms set status = 'superseded'
       where id = new.supersedes_id and status = 'active' and project_id = new.project_id;
      if not found then
        raise exception 'The version this revises is no longer in use; revise the current one instead.' using errcode = 'check_violation';
      end if;
    end if;
    return new;
  end if;

  -- Frozen: only a status step forward, nothing on the content or the dates.
  if new.title is distinct from old.title or new.activity is distinct from old.activity
     or new.hrcw is distinct from old.hrcw or new.ppe is distinct from old.ppe
     or new.permits is distinct from old.permits or new.plant is distinct from old.plant
     or new.legislation is distinct from old.legislation or new.prepared_by is distinct from old.prepared_by
     or new.reviewed_by is distinct from old.reviewed_by or new.steps is distinct from old.steps
     or new.kind is distinct from old.kind
     or new.activated_at is distinct from old.activated_at or new.activated_by is distinct from old.activated_by then
    raise exception 'This SWMS is in use and frozen; revise it instead.' using errcode = 'check_violation';
  end if;
  if old.status = 'active' and new.status in ('superseded', 'archived') then
    new.archived_at := case when new.status = 'archived' then now() else null end;
    return new;
  end if;
  if new.status = old.status then
    new.archived_at := old.archived_at;
    return new;
  end if;
  raise exception 'A % SWMS does not become %.', old.status, new.status using errcode = 'check_violation';
end;
$$;

create or replace function app.swms_project(p_swms uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$ select project_id from public.swms where id = p_swms; $$;
grant execute on function app.swms_project(uuid) to authenticated;

drop policy if exists "swms signatures writable while in use" on storage.objects;
create policy "swms signatures writable while in use" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'entry-photos'
    and (storage.foldername(name))[2] = 'swms'
    and app.can_sign_swms(((storage.foldername(name))[3])::uuid)
    and (storage.foldername(name))[1] = app.swms_project(((storage.foldername(name))[3])::uuid)::text
  );
