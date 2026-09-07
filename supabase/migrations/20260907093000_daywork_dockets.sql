-- ============================================================================
-- 20260907093000_daywork_dockets.sql
-- A docket number that arrives after the day is signed.
--
-- The client's dayworks docket often comes back a day or a week later. The
-- signed row cannot take it — it is immutable, and a correction for a docket
-- number is a hammer for a tack. So the number lives beside the record, keyed
-- to the daywork row, with when it was received and by whom. The client sheet
-- and the registers print it marked "added after signing"; the signed docket
-- PDF is untouched and still shows the day as it was signed.
-- ============================================================================

create table public.daywork_dockets (
  daywork_id   uuid primary key references public.dayworks (id) on delete cascade,
  docket_ref   text not null check (length(btrim(docket_ref)) > 0),
  received_on  date not null default current_date,
  note         text,
  recorded_by  uuid references auth.users (id),
  recorded_at  timestamptz not null default now()
);

comment on table public.daywork_dockets is
  'Docket numbers recorded after a daywork''s entry was signed. Beside the record, never in it; printed as "added after signing".';

alter table public.daywork_dockets enable row level security;
create policy daywork_dockets_select_member on public.daywork_dockets
  for select to authenticated using (exists (
    select 1 from public.dayworks dw join public.entries e on e.id = dw.entry_id
     where dw.id = daywork_id and app.is_project_member(e.project_id)));
grant select on public.daywork_dockets to authenticated;
grant all on public.daywork_dockets to service_role;

create or replace function public.set_daywork_docket(p_daywork_id uuid, p_docket_ref text, p_note text default null)
returns public.daywork_dockets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project uuid;
  v_on_record text;
  v_row public.daywork_dockets;
begin
  select e.project_id, dw.docket_ref into v_project, v_on_record
    from public.dayworks dw join public.entries e on e.id = dw.entry_id
   where dw.id = p_daywork_id;
  if not found or not app.is_project_member(v_project) then
    raise exception 'That daywork is not on one of your projects.';
  end if;
  if v_on_record is not null and btrim(v_on_record) <> '' then
    raise exception 'That daywork already carries docket % on the signed record.', v_on_record;
  end if;
  if p_docket_ref is null or btrim(p_docket_ref) = '' then
    raise exception 'A docket number is required.';
  end if;
  insert into public.daywork_dockets (daywork_id, docket_ref, note, recorded_by)
  values (p_daywork_id, btrim(p_docket_ref), nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
  on conflict (daywork_id) do update
    set docket_ref = excluded.docket_ref, note = excluded.note, recorded_by = excluded.recorded_by,
        recorded_at = now(), received_on = current_date
  returning * into v_row;
  return v_row;
end;
$$;
revoke all on function public.set_daywork_docket(uuid, text, text) from public;
grant execute on function public.set_daywork_docket(uuid, text, text) to authenticated, service_role;

-- The diary view carries the row id so a screen can find the docket beside it.
create or replace view diary.dayworks with (security_invoker = true) as
select d.entry_no, d.entry_date, d.project_id, d.project_name,
       dw.description, dw.labour, dw.plant, dw.materials, dw.hours, dw.docket_ref,
       dw.id as daywork_id
from public.dayworks dw join diary.entries d on d.entry_id = dw.entry_id;
grant select on diary.dayworks to authenticated, service_role;
