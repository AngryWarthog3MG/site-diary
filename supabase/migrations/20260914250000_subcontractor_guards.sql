-- ============================================================================
-- Subcontractors, after review (Codex pass 20):
--   * a job engages only a subcontractor of its own organisation;
--   * a retired document stays retired.
-- ============================================================================

create or replace function app.project_subcontractors_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.projects p join public.subcontractors s on s.org_id = p.org_id
     where p.id = new.project_id and s.id = new.subcontractor_id
  ) then
    raise exception 'A job engages a subcontractor of its own organisation.' using errcode = 'check_violation';
  end if;
  return new;
end; $$;
create trigger a_project_subcontractors_before_insert before insert on public.project_subcontractors
  for each row execute function app.project_subcontractors_before_insert();

create or replace function app.subcontractor_documents_before_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.subcontractor_id is distinct from old.subcontractor_id or new.kind is distinct from old.kind
     or new.title is distinct from old.title or new.reference is distinct from old.reference
     or new.issued_on is distinct from old.issued_on or new.expires_on is distinct from old.expires_on
     or new.file_path is distinct from old.file_path or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'A document is retired and replaced, not rewritten.' using errcode = 'check_violation';
  end if;
  if old.active = false and new.active = true then
    raise exception 'A retired document stays retired; record the renewal as a new one.' using errcode = 'check_violation';
  end if;
  return new;
end; $$;
