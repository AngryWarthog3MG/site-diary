-- An account closed when the person is removed from their last job, and reopened when they are added again
-- (README R115), go in the same access history as every other membership change (README R105).
alter table public.member_access_events drop constraint member_access_events_kind_check;
alter table public.member_access_events add constraint member_access_events_kind_check
  check (kind in ('added', 'changed', 'removed', 'two_factor_reset', 'account_closed', 'account_reopened'));
