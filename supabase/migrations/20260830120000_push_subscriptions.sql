-- ============================================================================
-- Push subscriptions — the knock-off reminder's delivery addresses.
--
-- One row per browser subscription. A user can hold several (phone and
-- laptop); an endpoint belongs to exactly one user. The reminder sender runs
-- as service_role on a schedule; users manage only their own rows.
-- ============================================================================

create table public.push_subscriptions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  endpoint         text not null unique,
  p256dh           text not null,
  auth             text not null,
  created_at       timestamptz not null default now(),
  -- Perth-local date of the last reminder sent, so one nudge a day is the cap.
  last_notified_on date
);

create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

create policy "push_subscriptions_select_own" on public.push_subscriptions
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "push_subscriptions_insert_own" on public.push_subscriptions
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "push_subscriptions_update_own" on public.push_subscriptions
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "push_subscriptions_delete_own" on public.push_subscriptions
  for delete to authenticated
  using (user_id = (select auth.uid()));

comment on table public.push_subscriptions is
  'Web-push endpoints for the knock-off reminder. Managed by their owner; sent to by the scheduled ops check as service_role.';
