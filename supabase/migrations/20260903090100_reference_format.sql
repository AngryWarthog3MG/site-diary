-- ============================================================================
-- 20260903090100_reference_format.sql
-- Entry references become {ORG}-{PROJECT}-{seq}: KBL-C001-002.
--
-- Owner call (2026-08-27): the brief's KBS_C001_DD_142 shape reads like an
-- identifier from a database, not a number on a document. Hyphens scan better
-- on dockets and in speech, and the DD infix said nothing anyone needed.
-- Entries already signed keep the serial they were signed with — the format
-- change is forward-only, like every other policy here.
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

  o_entry_no := format('%s-%s-%s',
                       v_org_code, v_proj_code, lpad(o_entry_seq::text, 3, '0'));
end;
$$;

create or replace function app.project_next_entry_no(p_project_id uuid)
returns text
language sql
stable
set search_path = ''
as $$
  select format('%s-%s-%s', o.code, p.code, lpad(p.next_entry_seq::text, 3, '0'))
    from public.projects p
    join public.organisations o on o.id = p.org_id
   where p.id = p_project_id;
$$;
