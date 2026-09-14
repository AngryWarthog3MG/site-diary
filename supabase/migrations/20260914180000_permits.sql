-- ============================================================================
-- Permits to work: issued over controls, accepted by the holder, closed out.
--
-- The fifth safety module. A permit is the written permission for one piece
-- of high-risk work in one place for one window of time — hot work, an
-- excavation, a confined space, work at height, an electrical isolation.
-- The issuer walks the controls (each yes or not applicable), names the
-- holder and the workers, sets the window, and both sign; the database
-- numbers it (PTW-001…), stamps the issue, and freezes it. Work ends with
-- a close-out — the area left safe, isolations removed, the fire watch
-- done — signed by whoever closes it; then it is frozen entirely. A permit
-- past its window is still a permit until it is closed, and says so.
-- ============================================================================

create table public.permits (
  id                        uuid primary key default gen_random_uuid(),
  project_id                uuid not null references public.projects (id) on delete restrict,
  seq                       integer not null,
  kind                      text not null check (kind in ('hot_work', 'excavation', 'confined_space', 'working_at_height', 'electrical', 'other')),
  title                     text not null check (length(btrim(title)) > 0),
  location                  text,
  valid_from                timestamptz not null,
  valid_to                  timestamptz not null,
  swms_id                   uuid references public.swms (id),
  plant                     text,
  workers                   text[] not null default '{}',
  controls                  jsonb not null default '[]'::jsonb,
  conditions                text,
  issuer_name               text not null check (length(btrim(issuer_name)) > 0),
  issuer_signature_path     text,
  holder_name               text not null check (length(btrim(holder_name)) > 0),
  holder_signature_path     text,
  issued_at                 timestamptz,
  issued_on_device_at       timestamptz,
  issued_by                 uuid not null references auth.users (id),
  status                    text not null default 'open' check (status in ('open', 'issued', 'closed', 'cancelled')),
  closeout_checks           jsonb,
  closeout_note             text,
  closeout_signature_path   text,
  closed_at                 timestamptz,
  closed_on_device_at       timestamptz,
  closed_by                 uuid references auth.users (id),
  cancel_reason             text,
  created_at                timestamptz not null default now(),
  constraint permits_window check (valid_to > valid_from)
);
create unique index permits_seq_idx on public.permits (project_id, seq);
create index permits_project_idx on public.permits (project_id, status, valid_to desc);

create or replace function app.permit_controls_answered(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p) = 'array' and jsonb_array_length(p) > 0
     and not exists (select 1 from jsonb_array_elements(p) c where coalesce(c ->> 'result', '') not in ('yes', 'na'));
$$;

create or replace function app.permit_path_ok(p_path text, p_project uuid, p_permit uuid)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_path is not null
     and split_part(p_path, '/', 1) = p_project::text
     and split_part(p_path, '/', 2) = 'permit'
     and split_part(p_path, '/', 3) = p_permit::text;
$$;

create or replace function app.permits_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtext('permits:' || new.project_id::text));
  select coalesce(max(seq), 0) + 1 into new.seq from public.permits where project_id = new.project_id;
  new.title := btrim(new.title);
  new.location := nullif(btrim(coalesce(new.location, '')), '');
  new.issuer_name := btrim(new.issuer_name);
  new.holder_name := btrim(new.holder_name);
  -- Born open: issue is an update carrying both signatures.
  new.status := 'open';
  new.issuer_signature_path := null; new.holder_signature_path := null;
  new.issued_at := null; new.issued_on_device_at := null;
  new.closeout_checks := null; new.closeout_note := null; new.closeout_signature_path := null;
  new.closed_at := null; new.closed_on_device_at := null; new.closed_by := null; new.cancel_reason := null;
  if new.swms_id is not null and not exists (select 1 from public.swms s where s.id = new.swms_id and s.project_id = new.project_id and s.status = 'active') then
    raise exception 'The SWMS named on the permit must be in use on this job.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger a_permits_before_insert before insert on public.permits
  for each row execute function app.permits_before_insert();

create or replace function app.permits_before_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.project_id is distinct from old.project_id or new.seq is distinct from old.seq
     or new.issued_by is distinct from old.issued_by or new.created_at is distinct from old.created_at then
    raise exception 'A permit keeps its job, its number and who raised it.' using errcode = 'check_violation';
  end if;
  if old.status in ('closed', 'cancelled') then
    raise exception 'A % permit is frozen.', old.status using errcode = 'check_violation';
  end if;

  if old.status = 'open' then
    -- Issue: both signatures, over every control answered, inside the window.
    if new.status = 'open' then
      new.issuer_signature_path := null; new.holder_signature_path := null; new.issued_at := null;
      return new;
    end if;
    if new.status <> 'issued' then
      raise exception 'An open permit is issued or cancelled; it is not closed.' using errcode = 'check_violation';
    end if;
    if not app.permit_controls_answered(new.controls) then
      raise exception 'Every control must be answered yes or not applicable before the permit is issued.' using errcode = 'check_violation';
    end if;
    if not app.permit_path_ok(new.issuer_signature_path, new.project_id, new.id)
       or not app.permit_path_ok(new.holder_signature_path, new.project_id, new.id) then
      raise exception 'The issuer and the holder both sign, into this permit''s own folder.' using errcode = 'check_violation';
    end if;
    if new.valid_to < now() then
      raise exception 'The permit window has already ended.' using errcode = 'check_violation';
    end if;
    if new.valid_from < now() - interval '7 days' or new.valid_from > now() + interval '7 days' or new.valid_to > new.valid_from + interval '30 days' then
      raise exception 'A permit window starts within a week of today and runs at most thirty days.' using errcode = 'check_violation';
    end if;
    new.issued_at := now();
    new.issued_on_device_at := coalesce(new.issued_on_device_at, now());
    return new;
  end if;

  -- Issued: frozen but for the close-out or a cancellation.
  if new.kind is distinct from old.kind or new.title is distinct from old.title or new.location is distinct from old.location
     or new.valid_from is distinct from old.valid_from or new.valid_to is distinct from old.valid_to
     or new.swms_id is distinct from old.swms_id or new.plant is distinct from old.plant or new.workers is distinct from old.workers
     or new.controls is distinct from old.controls or new.conditions is distinct from old.conditions
     or new.issuer_name is distinct from old.issuer_name or new.issuer_signature_path is distinct from old.issuer_signature_path
     or new.holder_name is distinct from old.holder_name or new.holder_signature_path is distinct from old.holder_signature_path
     or new.issued_at is distinct from old.issued_at or new.issued_on_device_at is distinct from old.issued_on_device_at then
    raise exception 'An issued permit is frozen; cancel it and raise another.' using errcode = 'check_violation';
  end if;
  if new.status = 'cancelled' then
    if length(btrim(coalesce(new.cancel_reason, ''))) = 0 then
      raise exception 'Say why the permit is cancelled.' using errcode = 'check_violation';
    end if;
    new.closed_at := now(); new.closed_by := coalesce(auth.uid(), new.closed_by);
    return new;
  end if;
  if new.status = 'closed' then
    if not app.permit_controls_answered(new.closeout_checks) then
      raise exception 'Every close-out check must be answered before the permit is closed.' using errcode = 'check_violation';
    end if;
    if not app.permit_path_ok(new.closeout_signature_path, new.project_id, new.id) then
      raise exception 'The close-out is signed into this permit''s own folder.' using errcode = 'check_violation';
    end if;
    new.closed_at := now();
    new.closed_on_device_at := coalesce(new.closed_on_device_at, now());
    new.closed_by := coalesce(auth.uid(), new.closed_by);
    return new;
  end if;
  if new.status = 'issued' then return new; end if;
  raise exception 'An issued permit does not become %.', new.status using errcode = 'check_violation';
end;
$$;
create trigger a_permits_before_update before update on public.permits
  for each row execute function app.permits_before_update();

alter table public.permits enable row level security;
create policy permits_select_member on public.permits
  for select to authenticated using (app.is_project_member(project_id));
create policy permits_insert_managers on public.permits
  for insert to authenticated
  with check (app.can_manage_incidents(project_id) and issued_by = (select auth.uid()));
create policy permits_update_managers on public.permits
  for update to authenticated
  using (app.can_manage_incidents(project_id) and status in ('open', 'issued'))
  with check (app.can_manage_incidents(project_id));
create policy permits_delete_own_open on public.permits
  for delete to authenticated
  using (issued_by = (select auth.uid()) and status = 'open' and app.can_manage_incidents(project_id));
grant select, insert, update, delete on public.permits to authenticated;
grant all on public.permits to service_role;

-- Signatures: {project_id}/permit/{permit_id}/{file}.
create policy "permit files writable by managers" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'entry-photos'
    and (storage.foldername(name))[2] = 'permit'
    and app.can_manage_incidents(((storage.foldername(name))[1])::uuid)
  );
