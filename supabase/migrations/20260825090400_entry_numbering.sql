-- ============================================================================
-- 20260825090400_entry_numbering.sql
-- Serialised entry numbers per project: {ORG}_{PROJECT}_DD_{seq}
-- e.g. KBS_C001_DD_142
--
-- Numbers are allocated at SIGNING, not at draft creation. Because a signed
-- entry can never be deleted, and nothing else advances the counter, the
-- serial run is gap-free: 001, 002, 003 with nothing missing. An abandoned or
-- deleted draft consumes no number.
--
-- The consequence is that serials follow signing order, not entry_date order.
-- Two supervisors who record on the same day are numbered in the order they
-- knock off. That matches how a carbonless docket book actually fills up.
--
-- Called from app.entries_enforce_immutable() (see 090700), which owns the
-- draft -> signed transition. Nothing else may write entry_seq or entry_no —
-- the entries_signature_complete check constraint makes a draft carrying a
-- serial an illegal row.
-- ============================================================================

create or replace function app.allocate_entry_no(
  p_project_id  uuid,
  out o_entry_seq integer,
  out o_entry_no  text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_proj_code text;
  v_org_code  text;
begin
  -- Locks the project row for the duration of the transaction, so two
  -- supervisors signing at the same moment serialise rather than collide.
  update public.projects p
     set next_entry_seq = p.next_entry_seq + 1
   where p.id = p_project_id
  returning p.next_entry_seq - 1, p.code
       into o_entry_seq, v_proj_code;

  if o_entry_seq is null then
    raise exception 'project % does not exist', p_project_id
      using errcode = 'foreign_key_violation';
  end if;

  select o.code
    into v_org_code
    from public.organisations o
    join public.projects p on p.org_id = o.id
   where p.id = p_project_id;

  o_entry_no := format('%s_%s_DD_%s',
                       v_org_code, v_proj_code, lpad(o_entry_seq::text, 3, '0'));
end;
$$;

comment on function app.allocate_entry_no(uuid) is
  'Advances a project''s entry counter under a row lock and formats the next serial. Called only from the signing trigger.';

-- ---------------------------------------------------------------------------
-- Display-only preview of the number a draft would take if it were signed now.
-- Provisional: another supervisor signing first will take it instead. Label it
-- as provisional wherever it is shown; the real number appears on signing.
--
-- SECURITY INVOKER on purpose — it reads projects and organisations under the
-- caller's own RLS, so a non-member simply gets null and no extra guard is
-- needed. (The browser can equally derive this from the columns it can already
-- select; this exists for server-side code.)
-- ---------------------------------------------------------------------------
create or replace function app.project_next_entry_no(p_project_id uuid)
returns text
language sql
stable
set search_path = ''
as $$
  select format('%s_%s_DD_%s', o.code, p.code, lpad(p.next_entry_seq::text, 3, '0'))
    from public.projects p
    join public.organisations o on o.id = p.org_id
   where p.id = p_project_id;
$$;

grant execute on function app.project_next_entry_no(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- A correction entry must supersede a signed entry in the same project.
-- ---------------------------------------------------------------------------
create or replace function app.validate_supersedes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project uuid;
  v_status  public.entry_status;
begin
  if new.supersedes_entry_id is null then
    return new;
  end if;

  select e.project_id, e.status
    into v_project, v_status
    from public.entries e
   where e.id = new.supersedes_entry_id;

  if v_project is null then
    raise exception 'superseded entry % does not exist', new.supersedes_entry_id
      using errcode = 'foreign_key_violation';
  end if;

  if v_project <> new.project_id then
    raise exception 'a correction entry must belong to the same project as the entry it supersedes'
      using errcode = 'check_violation';
  end if;

  if v_status <> 'signed' then
    raise exception 'only a signed entry can be superseded; entry % is still a draft', new.supersedes_entry_id
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger entries_validate_supersedes
  before insert or update of supersedes_entry_id on public.entries
  for each row execute function app.validate_supersedes();
