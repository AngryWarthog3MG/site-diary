-- Renaming someone back to a name that was folded in as their alias (README R140): the alias row that would now point
-- at itself is dropped rather than refused.
create or replace function public.rename_staff(p_staff_id uuid, p_name text, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_old   text;
  v_org   uuid;
  v_new   text;
  v_crew  integer;
  v_tix   integer;
  v_ind   integer;
  v_who   text;
begin
  select s.name, s.org_id into v_old, v_org from public.staff s where s.id = p_staff_id;
  if not found then
    raise exception 'That person is not on the staff list.' using errcode = 'no_data_found';
  end if;
  if not app.can_manage_crew(v_org) then
    raise exception 'Only the office renames someone on the staff list.' using errcode = 'insufficient_privilege';
  end if;
  v_new := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  if length(v_new) < 2 or v_new !~ '[[:alpha:]]' then
    raise exception 'Give the person their name.' using errcode = 'check_violation';
  end if;
  if v_new = v_old then
    raise exception 'That is already their name.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.staff s where s.org_id = v_org and lower(s.name) = lower(v_new) and s.id <> p_staff_id) then
    raise exception '% is already on the staff list. Two rows that are one person are combined on the Timesheets page, not renamed.', v_new
      using errcode = 'unique_violation';
  end if;

  perform set_config('app.rename', 'on', true);
  update public.staff set name = v_new where id = p_staff_id;
  perform set_config('app.rename', '', true);

  update public.crew c
     set name = v_new,
         aliases = (select array_agg(distinct a) from unnest(coalesce(c.aliases, '{}') || array[v_old]) a where lower(a) <> lower(v_new))
    from public.projects p
   where p.id = c.project_id and p.org_id = v_org
     and lower(regexp_replace(btrim(c.name), '\s+', ' ', 'g')) = lower(v_old);
  get diagnostics v_crew = row_count;

  update public.crew_tickets t set person_name = v_new
   where t.org_id = v_org and lower(regexp_replace(btrim(t.person_name), '\s+', ' ', 'g')) = lower(v_old);
  get diagnostics v_tix = row_count;

  update public.crew_inductions i set person_name = v_new
    from public.projects p
   where p.id = i.project_id and p.org_id = v_org
     and lower(regexp_replace(btrim(i.person_name), '\s+', ' ', 'g')) = lower(v_old);
  get diagnostics v_ind = row_count;

  -- The signed record keeps the old name; the company's list of names that are one person folds it in (README R107).
  -- An alias that IS the new name would now point at itself: it goes, the new name is the name again.
  delete from public.person_aliases where org_id = v_org and lower(alias) = lower(v_new);
  update public.person_aliases set name = v_new where org_id = v_org and lower(name) = lower(v_old) and lower(alias) <> lower(v_new);
  select pr.full_name into v_who from public.profiles pr where pr.id = (select auth.uid());
  insert into public.person_aliases (org_id, alias, name, note)
  values (v_org, v_old, v_new, coalesce(nullif(btrim(p_note), ''), format('Renamed on the staff list by %s, %s', coalesce(v_who, 'the office'), to_char(app.perth_today(), 'DD/MM/YYYY'))))
  on conflict (org_id, lower(alias)) do update set name = excluded.name, note = excluded.note;

  return jsonb_build_object('old_name', v_old, 'new_name', v_new, 'crew_rows', v_crew, 'tickets', v_tix, 'inductions', v_ind);
end;
$$;
