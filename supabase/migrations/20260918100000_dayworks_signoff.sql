-- ============================================================================
-- The client's signature on a dayworks sheet.
--
-- The sheet (README R83) goes out as a PDF, gets signed by the head
-- contractor, and comes back — and until now came back to nothing. It lived
-- in an inbox, and in three months, when the claim is argued, a countersigned
-- dayworks sheet is the strongest document in the file.
--
-- So it is recorded against the job with what it covered AT THE TIME: the
-- period, the items, the hours. A later correction may change what the
-- schedule says for those dates, and the record of what the client actually
-- put their name to must not change with it. Frozen on insert, like every
-- other signature in this app.
--
-- This is NOT the record of the works — that is the signed diary, which every
-- line of the sheet traces back to. This is the record of the acknowledgement.
-- ============================================================================

create table public.dayworks_signoffs (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid not null references public.projects (id) on delete restrict,

  -- The period the sheet covered. Null means open at that end, exactly as the
  -- screen's "whole job" does.
  period_from        date,
  period_to          date,
  period_label       text not null check (length(btrim(period_label)) > 0),

  -- What the sheet said when it was signed. Never recomputed.
  items              integer not null check (items >= 0),
  hours              numeric(10,2) not null check (hours >= 0),
  hours_not_recorded integer not null default 0 check (hours_not_recorded >= 0),
  photos             integer not null default 0 check (photos >= 0),

  -- Who signed it, for the client.
  signed_by_name     text not null check (length(btrim(signed_by_name)) > 0),
  signed_by_position text,
  signed_on          date not null,
  -- The countersigned sheet itself, in bucket 'dayworks-signoffs'.
  file_path          text,
  note               text,

  recorded_by        uuid references auth.users (id),
  created_at         timestamptz not null default now(),

  constraint dayworks_signoffs_period_order check (period_from is null or period_to is null or period_from <= period_to)
);
create index dayworks_signoffs_project_idx on public.dayworks_signoffs (project_id, signed_on desc);

comment on table public.dayworks_signoffs is
  'A dayworks sheet the head contractor signed: what it covered, who signed it, and the countersigned file. Frozen — it is what they put their name to, not what the schedule says today.';

create or replace function app.dayworks_signoffs_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.signed_on > app.perth_today() then
    raise exception 'Record it once it has been signed.' using errcode = 'check_violation';
  end if;
  if new.period_to is not null and new.signed_on < new.period_to then
    raise exception 'A sheet cannot be signed before the work it covers was done.' using errcode = 'check_violation';
  end if;
  new.signed_by_name := regexp_replace(btrim(new.signed_by_name), '\s+', ' ', 'g');
  new.signed_by_position := nullif(regexp_replace(btrim(coalesce(new.signed_by_position, '')), '\s+', ' ', 'g'), '');
  new.recorded_by := coalesce((select auth.uid()), new.recorded_by);
  new.created_at := now();
  return new;
end; $$;

create trigger a_dayworks_signoffs_before_insert before insert on public.dayworks_signoffs
  for each row execute function app.dayworks_signoffs_before_insert();
create trigger a_dayworks_signoffs_no_update before update on public.dayworks_signoffs
  for each row execute function app.frozen_row();
create trigger a_dayworks_signoffs_no_delete before delete on public.dayworks_signoffs
  for each row execute function app.frozen_row();

alter table public.dayworks_signoffs enable row level security;

-- The claims record: the labourer does not read it, like every other register.
create policy dayworks_signoffs_select on public.dayworks_signoffs
  for select to authenticated
  using (app.is_project_member(project_id) and app.reads_record(project_id));
create policy dayworks_signoffs_insert on public.dayworks_signoffs
  for insert to authenticated
  with check (app.can_manage_registers(project_id));

grant select, insert on public.dayworks_signoffs to authenticated;
grant all on public.dayworks_signoffs to service_role;

-- ---------------------------------------------------------------------------
-- The countersigned sheet: {project_id}/{signoff_id}.{ext}
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('dayworks-signoffs', 'dayworks-signoffs', false, 52428800,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
on conflict (id) do nothing;

create policy "dayworks signoffs readable by the record's readers" on storage.objects
  for select to authenticated
  using (bucket_id = 'dayworks-signoffs' and app.reads_record(app.storage_project_id(name)));
create policy "dayworks signoffs writable by register keepers" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'dayworks-signoffs' and app.can_manage_registers(app.storage_project_id(name)));

-- A file whose row was refused can be cleared by the person who uploaded it —
-- only ever a file no sign-off names, so a recorded signature is never removable.
create policy "dayworks signoffs unreferenced removable" on storage.objects
  for delete to authenticated
  using (bucket_id = 'dayworks-signoffs'
         and app.can_manage_registers(app.storage_project_id(name))
         and not exists (select 1 from public.dayworks_signoffs s where s.file_path = name));
