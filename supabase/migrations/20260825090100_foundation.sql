-- ============================================================================
-- 20260825090100_foundation.sql
-- Extensions, private helper schema, enums, and the profiles table.
-- Step 1 of the build order: schema, RLS, immutability, auth.
-- ============================================================================

-- No extensions required: gen_random_uuid() and sha256() are both core
-- Postgres functions on the versions Supabase runs.

-- All security-definer helpers live in `app`, never in `public`, so they are
-- not exposed through PostgREST.
create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.member_role     as enum ('supervisor', 'pm', 'admin');
create type public.entry_status    as enum ('draft', 'signed');
create type public.hire_type       as enum ('wet', 'dry');
create type public.delay_category  as enum ('weather', 'access', 'design', 'other');
create type public.weather_source  as enum ('bom_auto', 'manual');

-- Provenance metadata carried by every AI-extracted row (brief §4).
create type public.confidence      as enum ('high', 'low');

-- The six required sections (brief §4 "completeness check"). `nil_confirmed`
-- is what makes a deliberate "no plant on site" distinguishable from a gap.
create type public.entry_section   as enum
  ('labour', 'plant', 'work_items', 'variations', 'delays', 'weather');
create type public.section_state   as enum ('gap', 'captured', 'nil_confirmed');

-- ---------------------------------------------------------------------------
-- profiles — application-side mirror of auth.users
-- ---------------------------------------------------------------------------
create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text,
  full_name  text,
  phone      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is
  'Display identity for auth users. Populated on signup by app.handle_new_user().';

create or replace function app.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, phone)
  values (
    new.id,
    new.email,
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'phone', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_user();

create or replace function app.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function app.touch_updated_at();
