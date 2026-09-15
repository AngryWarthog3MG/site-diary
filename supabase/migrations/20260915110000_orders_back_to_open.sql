-- Back to open clears the supplier and the order reference too: a request that
-- was not actually ordered carries no procurement details (Codex pass 33).
create or replace function app.orders_before_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
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
