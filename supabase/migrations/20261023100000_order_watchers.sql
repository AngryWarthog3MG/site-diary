-- Order watchers (README R165).
--
-- Mitchell: "when someone adds an issue or order item, send me a notification each time, and a reminder every six hours
-- until it is closed out." The urgent email to the job's report list (20260915130000) stays. This is a second, personal
-- channel: an office person puts themselves on the company's watch list and is told — on their phone, and by email — of
-- every request raised on the company's jobs, then again every so many hours while it stays open or ordered. The two
-- stamps on the request are the server's, like notified_at: no phone may claim a watcher was told.

create table public.order_watchers (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organisations (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  every_hours  integer not null default 6 check (every_hours between 1 and 168),
  created_at   timestamptz not null default now(),
  unique (org_id, user_id)
);
comment on table public.order_watchers is
  'Office people told of every order and plant issue on the company''s jobs, and reminded every `every_hours` until it is finished (README R165).';

alter table public.order_watchers enable row level security;
-- A watcher sees their own row; the office sees the company's list; an office person adds or removes themselves.
create policy order_watchers_select on public.order_watchers for select to authenticated
  using (user_id = (select auth.uid()) or app.is_org_office(org_id));
create policy order_watchers_insert on public.order_watchers for insert to authenticated
  with check (user_id = (select auth.uid()) and app.is_org_office(org_id));
create policy order_watchers_update on public.order_watchers for update to authenticated
  using (user_id = (select auth.uid()) and app.is_org_office(org_id)) with check (user_id = (select auth.uid()) and app.is_org_office(org_id));
create policy order_watchers_delete on public.order_watchers for delete to authenticated
  using (user_id = (select auth.uid()));
grant select, insert, update, delete on public.order_watchers to authenticated;
grant all on public.order_watchers to service_role;

alter table public.orders
  add column watchers_notified_at timestamptz,
  add column last_reminded_at timestamptz;
comment on column public.orders.watchers_notified_at is 'When the watchers were first told of this request (README R165). The server''s.';
comment on column public.orders.last_reminded_at is 'When the watchers were last reminded it is still open (README R165). The server''s.';

-- Born unstamped; stamped by the service role alone. Runs AFTER a_orders_before_* (alphabetical), which already set
-- what they set, so these two columns are the only thing this function touches.
create or replace function app.orders_watch_stamps()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.watchers_notified_at := null;
    new.last_reminded_at := null;
    return new;
  end if;
  if (new.watchers_notified_at is distinct from old.watchers_notified_at or new.last_reminded_at is distinct from old.last_reminded_at)
     and auth.uid() is not null then
    raise exception 'Whether the watchers were told is recorded by the server.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger b_orders_watch_stamps before insert or update on public.orders
  for each row execute function app.orders_watch_stamps();
