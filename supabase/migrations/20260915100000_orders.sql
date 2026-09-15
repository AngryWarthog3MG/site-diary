-- ============================================================================
-- Orders and plant issues: the things a supervisor thinks of on site that the
-- office has to act on. Diesel, consumables, a part, anything — and a fault on
-- a machine (a light out, a beeper not working) that is not yet a prestart
-- defect. Raised on the phone in seconds, with or without signal; numbered per
-- job (ORD-001…) by the database; moved along by whoever orders and receives.
--
-- What was asked for is editable only while the request is still open; once
-- it is ordered, done or cancelled the request itself is frozen and the
-- lifecycle stamps are the database's. Updates are append-only. A request is
-- never deleted once it has moved — the raiser may remove their own while it is
-- still open, for a slip of the thumb.
--
-- Who: anyone on gate/prestart duty (supervisor, admin, leading hand) raises
-- and updates; those plus the PM order, receive and cancel.
-- ============================================================================

create table public.orders (
  id                   uuid primary key default gen_random_uuid(),
  project_id           uuid not null references public.projects (id) on delete restrict,
  seq                  integer not null,
  kind                 text not null check (kind in ('material', 'plant_issue')),
  item                 text not null check (length(btrim(item)) > 0),
  quantity             text,
  plant                text,
  needed_by            date,
  urgent               boolean not null default false,
  notes                text,
  photo_urls           text[] not null default '{}',
  raised_by            uuid not null references auth.users (id),
  raised_at            timestamptz not null default now(),
  raised_on_device_at  timestamptz not null default now(),
  status               text not null default 'open' check (status in ('open', 'ordered', 'done', 'cancelled')),
  ordered_at           timestamptz,
  ordered_by           uuid references auth.users (id),
  supplier             text,
  order_ref            text,
  done_at              timestamptz,
  done_by              uuid references auth.users (id),
  done_note            text,
  cancelled_at         timestamptz,
  cancelled_by         uuid references auth.users (id),
  cancel_reason        text,
  created_at           timestamptz not null default now(),
  constraint orders_raised_by_profiles_fkey foreign key (raised_by) references public.profiles (id),
  constraint orders_seq_idx unique (project_id, seq)
);
create index orders_open_idx on public.orders (project_id, status, kind);

create table public.order_updates (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.orders (id) on delete restrict,
  body        text not null check (length(btrim(body)) > 0),
  created_by  uuid not null references auth.users (id),
  created_at  timestamptz not null default now(),
  constraint order_updates_created_by_profiles_fkey foreign key (created_by) references public.profiles (id)
);
create index order_updates_order_idx on public.order_updates (order_id, created_at);

create or replace function app.orders_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtext('orders:' || new.project_id::text));
  select coalesce(max(seq), 0) + 1 into new.seq from public.orders where project_id = new.project_id;
  new.item := btrim(new.item);
  new.quantity := nullif(btrim(coalesce(new.quantity, '')), '');
  new.plant := nullif(btrim(coalesce(new.plant, '')), '');
  new.notes := nullif(btrim(coalesce(new.notes, '')), '');
  new.raised_at := now();
  if new.raised_on_device_at > now() + interval '1 hour' or new.raised_on_device_at < now() - interval '30 days' then
    new.raised_on_device_at := now();
  end if;
  new.status := 'open';
  new.ordered_at := null; new.ordered_by := null; new.supplier := null; new.order_ref := null;
  new.done_at := null; new.done_by := null; new.done_note := null;
  new.cancelled_at := null; new.cancelled_by := null; new.cancel_reason := null;
  return new;
end;
$$;
create trigger a_orders_before_insert before insert on public.orders
  for each row execute function app.orders_before_insert();

create or replace function app.orders_before_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Identity and provenance never move.
  if new.project_id is distinct from old.project_id or new.seq is distinct from old.seq or new.kind is distinct from old.kind
     or new.photo_urls is distinct from old.photo_urls or new.raised_by is distinct from old.raised_by
     or new.raised_at is distinct from old.raised_at or new.raised_on_device_at is distinct from old.raised_on_device_at
     or new.created_at is distinct from old.created_at then
    raise exception 'Who raised it, when, and its photos do not change.' using errcode = 'check_violation';
  end if;
  if old.status in ('done', 'cancelled') then
    raise exception 'A finished request is frozen.' using errcode = 'check_violation';
  end if;
  -- What was asked for may be corrected only while it is still open.
  if old.status <> 'open' and (new.item is distinct from old.item or new.quantity is distinct from old.quantity
     or new.plant is distinct from old.plant or new.needed_by is distinct from old.needed_by
     or new.urgent is distinct from old.urgent or new.notes is distinct from old.notes) then
    raise exception 'Once ordered, what was asked for does not change; add an update or cancel and raise again.' using errcode = 'check_violation';
  end if;
  new.item := btrim(new.item);
  new.quantity := nullif(btrim(coalesce(new.quantity, '')), '');
  new.plant := nullif(btrim(coalesce(new.plant, '')), '');
  new.notes := nullif(btrim(coalesce(new.notes, '')), '');
  new.supplier := nullif(btrim(coalesce(new.supplier, '')), '');
  new.order_ref := nullif(btrim(coalesce(new.order_ref, '')), '');
  new.done_note := nullif(btrim(coalesce(new.done_note, '')), '');
  new.cancel_reason := nullif(btrim(coalesce(new.cancel_reason, '')), '');

  if new.status = 'ordered' then
    if old.status <> 'ordered' then
      new.ordered_at := now();
      new.ordered_by := coalesce(auth.uid(), new.ordered_by);
    else
      new.ordered_at := old.ordered_at; new.ordered_by := old.ordered_by;
    end if;
    new.done_at := null; new.done_by := null; new.done_note := null;
    new.cancelled_at := null; new.cancelled_by := null; new.cancel_reason := null;
  elsif new.status = 'done' then
    if old.status = 'ordered' then new.ordered_at := old.ordered_at; new.ordered_by := old.ordered_by;
    else new.ordered_at := null; new.ordered_by := null; end if;
    new.done_at := now();
    new.done_by := coalesce(auth.uid(), new.done_by);
    new.cancelled_at := null; new.cancelled_by := null; new.cancel_reason := null;
  elsif new.status = 'cancelled' then
    if new.cancel_reason is null then
      raise exception 'Say why it is cancelled.' using errcode = 'check_violation';
    end if;
    if old.status = 'ordered' then new.ordered_at := old.ordered_at; new.ordered_by := old.ordered_by;
    else new.ordered_at := null; new.ordered_by := null; end if;
    new.cancelled_at := now();
    new.cancelled_by := coalesce(auth.uid(), new.cancelled_by);
    new.done_at := null; new.done_by := null; new.done_note := null;
  else
    -- Back to open: the order stamps go, the request stands.
    new.ordered_at := null; new.ordered_by := null;
    new.done_at := null; new.done_by := null; new.done_note := null;
    new.cancelled_at := null; new.cancelled_by := null; new.cancel_reason := null;
  end if;
  return new;
end;
$$;
create trigger a_orders_before_update before update on public.orders
  for each row execute function app.orders_before_update();

create or replace function app.orders_before_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status <> 'open' then
    raise exception 'A request that has moved is part of the record; cancel it instead.' using errcode = 'check_violation';
  end if;
  return old;
end;
$$;
create trigger a_orders_before_delete before delete on public.orders
  for each row execute function app.orders_before_delete();

create or replace function app.order_updates_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.orders o where o.id = new.order_id and o.status in ('done', 'cancelled')) then
    raise exception 'A finished request takes no more updates.' using errcode = 'check_violation';
  end if;
  new.body := btrim(new.body);
  return new;
end;
$$;
create trigger a_order_updates_before_insert before insert on public.order_updates
  for each row execute function app.order_updates_before_insert();
create trigger a_order_updates_frozen before update or delete on public.order_updates
  for each row execute function app.frozen_row();

-- Who moves a request along: the crew who raise them, and the PM who orders.
create or replace function app.can_progress_orders(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.can_run_talks(p_project) or app.can_manage_registers(p_project);
$$;
grant execute on function app.can_progress_orders(uuid) to authenticated;

alter table public.orders enable row level security;
alter table public.order_updates enable row level security;

create policy orders_select_member on public.orders
  for select to authenticated using (app.is_project_member(project_id));
create policy orders_insert_crew on public.orders
  for insert to authenticated
  with check (app.can_run_talks(project_id) and raised_by = (select auth.uid()));
create policy orders_update_progress on public.orders
  for update to authenticated
  using (app.can_progress_orders(project_id)) with check (app.can_progress_orders(project_id));
create policy orders_delete_own_open on public.orders
  for delete to authenticated
  using (raised_by = (select auth.uid()) and status = 'open');

create policy order_updates_select_member on public.order_updates
  for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and app.is_project_member(o.project_id)));
create policy order_updates_insert_progress on public.order_updates
  for insert to authenticated
  with check (created_by = (select auth.uid())
              and exists (select 1 from public.orders o where o.id = order_id and app.can_progress_orders(o.project_id)));

grant select, insert, update, delete on public.orders to authenticated;
grant select, insert on public.order_updates to authenticated;
grant all on public.orders, public.order_updates to service_role;

-- Photos: {project_id}/order/{order_id}/{file}, written by whoever raises.
create policy "order photos writable by crew" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'entry-photos'
    and (storage.foldername(name))[2] = 'order'
    and app.can_run_talks(((storage.foldername(name))[1])::uuid)
  );
