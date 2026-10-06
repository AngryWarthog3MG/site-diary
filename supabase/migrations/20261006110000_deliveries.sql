-- ============================================================================
-- Deliveries (README R127).
--
-- "A calendar of deliveries: I add upcoming deliveries, they show up per job
-- on the day — plants booked for the 12th for Curtin show on Curtin's page
-- that day — and a full calendar gives a snapshot of everything ordered to
-- come in."
--
-- A delivery is booked for a day on a job: what, how much, from whom, when in
-- the day. It is received on the day (with the docket number, by whoever
-- takes it), or cancelled with a reason, or moved — and every date it was
-- ever booked for is kept, because "they said the 12th, then the 14th" is
-- half of every supply dispute. Received and cancelled are frozen; nothing is
-- deleted. It may point at the order it fulfils; the calendar also shows
-- material orders by their needed-by date, read from the orders table, so
-- what has been asked for and what has been booked sit on the same page.
-- ============================================================================

create table public.deliveries (
  id                      uuid primary key default gen_random_uuid(),
  project_id              uuid not null references public.projects (id) on delete restrict,
  booked_for              date not null,
  -- When in the day, as the supplier said it: "AM", "7–9", "after lunch". Free text, never a guess.
  window_text             text,
  item                    text not null check (btrim(item) <> ''),
  quantity                text,
  supplier                text,
  order_id                uuid references public.orders (id),
  notes                   text,
  status                  text not null default 'booked' check (status in ('booked', 'received', 'cancelled')),
  -- Every earlier day it was booked for, oldest first.
  moved_from              date[] not null default '{}',
  received_at             timestamptz,
  received_by             uuid references public.profiles (id),
  received_on_device_at   timestamptz,
  docket_ref              text,
  received_note           text,
  cancelled_at            timestamptz,
  cancelled_by            uuid references public.profiles (id),
  cancel_reason           text,
  booked_by               uuid default auth.uid() references public.profiles (id),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint deliveries_received_whole check ((status = 'received') = (received_at is not null)),
  constraint deliveries_cancelled_whole check ((status = 'cancelled') = (cancelled_at is not null))
);
create index deliveries_project_day on public.deliveries (project_id, booked_for);

create or replace function app.deliveries_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  tidy_text text;
begin
  new.item := btrim(regexp_replace(new.item, '\s+', ' ', 'g'));
  new.quantity := nullif(btrim(regexp_replace(coalesce(new.quantity, ''), '\s+', ' ', 'g')), '');
  new.supplier := nullif(btrim(regexp_replace(coalesce(new.supplier, ''), '\s+', ' ', 'g')), '');
  new.window_text := nullif(btrim(regexp_replace(coalesce(new.window_text, ''), '\s+', ' ', 'g')), '');
  new.notes := nullif(btrim(coalesce(new.notes, '')), '');
  new.docket_ref := nullif(btrim(coalesce(new.docket_ref, '')), '');
  new.received_note := nullif(btrim(coalesce(new.received_note, '')), '');
  new.cancel_reason := nullif(btrim(coalesce(new.cancel_reason, '')), '');
  if new.order_id is not null and not exists (select 1 from public.orders o where o.id = new.order_id and o.project_id = new.project_id) then
    raise exception 'That order is not on this job.' using errcode = 'check_violation';
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'booked' then
      raise exception 'A delivery is booked first; it is received or cancelled afterwards.' using errcode = 'check_violation';
    end if;
    new.moved_from := '{}';
    new.received_at := null; new.received_by := null; new.received_on_device_at := null;
    new.cancelled_at := null; new.cancelled_by := null;
    if (select auth.uid()) is not null then new.booked_by := (select auth.uid()); end if;
    new.created_at := now(); new.updated_at := now();
    return new;
  end if;

  -- Updates: identity fixed; a received or cancelled delivery is frozen.
  if new.project_id <> old.project_id or new.booked_by is distinct from old.booked_by or new.created_at <> old.created_at then
    raise exception 'A delivery stays on its job, booked by whoever booked it.' using errcode = 'check_violation';
  end if;
  if old.status <> 'booked' then
    raise exception 'This delivery is % and does not change.', old.status using errcode = 'check_violation';
  end if;
  new.moved_from := old.moved_from;
  if new.booked_for <> old.booked_for then
    new.moved_from := old.moved_from || old.booked_for;
  end if;
  if new.status = 'received' then
    new.received_at := now();
    new.received_by := coalesce((select auth.uid()), new.received_by);
    if new.received_on_device_at is null or new.received_on_device_at > now() + interval '5 minutes' or new.received_on_device_at < now() - interval '14 days' then
      new.received_on_device_at := now();
    end if;
    new.cancelled_at := null; new.cancelled_by := null; new.cancel_reason := null;
  elsif new.status = 'cancelled' then
    if new.cancel_reason is null then
      raise exception 'Say why the delivery is cancelled.' using errcode = 'check_violation';
    end if;
    new.cancelled_at := now();
    new.cancelled_by := coalesce((select auth.uid()), new.cancelled_by);
    new.received_at := null; new.received_by := null; new.received_on_device_at := null; new.docket_ref := null; new.received_note := null;
  else
    new.received_at := null; new.received_by := null; new.received_on_device_at := null;
    new.cancelled_at := null; new.cancelled_by := null; new.cancel_reason := null;
  end if;
  new.updated_at := now();
  tidy_text := null;
  return new;
end;
$$;
create trigger deliveries_guard before insert or update on public.deliveries
  for each row execute function app.deliveries_guard();
create trigger a_deliveries_no_delete before delete on public.deliveries
  for each row execute function app.frozen_row();

-- Read by whoever reads the job's record; booked, received, moved and cancelled by whoever runs the day (the same
-- people who raise orders). The labourer reads none of it.
alter table public.deliveries enable row level security;
create policy deliveries_select on public.deliveries for select to authenticated
  using (app.is_project_member(project_id) and app.reads_record(project_id));
create policy deliveries_insert on public.deliveries for insert to authenticated with check (app.can_run_talks(project_id));
create policy deliveries_update on public.deliveries for update to authenticated
  using (app.can_run_talks(project_id)) with check (app.can_run_talks(project_id));
revoke all on public.deliveries from anon, authenticated;
grant select, insert, update on public.deliveries to authenticated;
grant all on public.deliveries to service_role;
