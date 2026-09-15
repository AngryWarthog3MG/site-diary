-- Urgent orders and plant issues reach the office by email, once. `notified_at`
-- is the server's mark that it was sent (claimed by the service role before
-- sending, handed back on failure, retried nightly) — a phone cannot set it.
alter table public.orders add column if not exists notified_at timestamptz;

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
  new.notified_at := null;
  return new;
end;
$$;

create or replace function app.orders_before_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The office-emailed mark is the server's: no phone may claim the office was told.
  if new.notified_at is distinct from old.notified_at and auth.uid() is not null then
    raise exception 'Whether the office was emailed is recorded by the server.' using errcode = 'check_violation';
  end if;
  if new.notified_at is distinct from old.notified_at and old.status in ('done', 'cancelled') then
    return new; -- the nightly retry never reaches a finished request, but a claim handed back must not trip the freeze
  end if;
  if new.project_id is distinct from old.project_id or new.seq is distinct from old.seq or new.kind is distinct from old.kind
     or new.photo_urls is distinct from old.photo_urls or new.raised_by is distinct from old.raised_by
     or new.raised_at is distinct from old.raised_at or new.raised_on_device_at is distinct from old.raised_on_device_at
     or new.created_at is distinct from old.created_at then
    raise exception 'Who raised it, when, and its photos do not change.' using errcode = 'check_violation';
  end if;
  if old.status in ('done', 'cancelled') then
    raise exception 'A finished request is frozen.' using errcode = 'check_violation';
  end if;
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
    -- Back to open: it was not ordered after all, so nothing about an order remains.
    new.ordered_at := null; new.ordered_by := null; new.supplier := null; new.order_ref := null;
    new.done_at := null; new.done_by := null; new.done_note := null;
    new.cancelled_at := null; new.cancelled_by := null; new.cancel_reason := null;
  end if;
  return new;
end;
$$;
