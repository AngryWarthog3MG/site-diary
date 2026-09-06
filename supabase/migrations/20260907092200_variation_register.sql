-- ============================================================================
-- 20260907092200_variation_register.sql
-- The variation register: what happened to each variation after it was raised.
--
-- The diary records that a variation was directed — the signed row is the
-- evidence, and it never changes. What the office needs alongside it is the
-- life of that variation afterwards: priced, submitted, approved or rejected,
-- paid. That is not part of the day's record, so it lives beside it:
--
--   variation_register        one row per variation as a commercial item
--   variation_register_links  which diary rows (possibly across several days
--                             and corrections) are mentions of that item
--   variation_status_events   every status change, by whom, when, with a note
--
-- Signing a day registers its variations automatically (matched to an
-- existing item by VR reference, else by title, else a new item). Status is
-- changed only through set_variation_status(), which writes the event. The
-- signed diary rows are never touched; the register is a ledger about them.
-- ============================================================================

create type public.variation_status as enum
  ('raised', 'priced', 'submitted', 'approved', 'rejected', 'paid');

create table public.variation_register (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects (id) on delete restrict,
  title           text not null check (length(btrim(title)) > 0),
  vr_ref          text,
  raised_on       date not null,
  status          public.variation_status not null default 'raised',
  estimated_cost  numeric(14,2) check (estimated_cost is null or estimated_cost >= 0),
  agreed_cost     numeric(14,2) check (agreed_cost is null or agreed_cost >= 0),
  submitted_on    date,
  decided_on      date,
  paid_on         date,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index variation_register_project_idx on public.variation_register (project_id, raised_on);
create trigger variation_register_touch
  before update on public.variation_register
  for each row execute function app.touch_updated_at();

create table public.variation_register_links (
  variation_id uuid primary key references public.variations (id) on delete cascade,
  register_id  uuid not null references public.variation_register (id) on delete cascade
);
create index variation_register_links_register_idx on public.variation_register_links (register_id);

create table public.variation_status_events (
  id          uuid primary key default gen_random_uuid(),
  register_id uuid not null references public.variation_register (id) on delete cascade,
  status      public.variation_status not null,
  note        text,
  changed_by  uuid references auth.users (id),
  changed_at  timestamptz not null default now()
);
create index variation_status_events_register_idx on public.variation_status_events (register_id, changed_at);

comment on table public.variation_register is
  'One row per variation as a commercial item: its status after being raised. A ledger beside the diary, never part of a signed record.';

-- Members read; nothing is written directly — the signing trigger and the two
-- RPCs below are the only writers, and both run as definer.
alter table public.variation_register enable row level security;
alter table public.variation_register_links enable row level security;
alter table public.variation_status_events enable row level security;

create policy variation_register_select_member on public.variation_register
  for select to authenticated using (app.is_project_member(project_id));
create policy variation_register_links_select_member on public.variation_register_links
  for select to authenticated using (exists (
    select 1 from public.variation_register r
     where r.id = register_id and app.is_project_member(r.project_id)));
create policy variation_status_events_select_member on public.variation_status_events
  for select to authenticated using (exists (
    select 1 from public.variation_register r
     where r.id = register_id and app.is_project_member(r.project_id)));

grant select on public.variation_register, public.variation_register_links, public.variation_status_events to authenticated;
grant all on public.variation_register, public.variation_register_links, public.variation_status_events to service_role;

-- ---------------------------------------------------------------------------
-- Registering a signed day's variations.
-- ---------------------------------------------------------------------------
create or replace function app.register_variations_for_entry(p_entry_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry record;
  v       record;
  v_reg   uuid;
  v_ref   text;
  v_title text;
begin
  select id, project_id, entry_date into v_entry from public.entries where id = p_entry_id;
  if not found then return; end if;

  for v in select * from public.variations where entry_id = p_entry_id loop
    continue when exists (select 1 from public.variation_register_links l where l.variation_id = v.id);

    v_ref   := nullif(upper(regexp_replace(coalesce(v.vr_ref, ''), '\s+', '', 'g')), '');
    v_title := lower(btrim(v.description));
    v_reg   := null;

    -- The same VR reference is the same variation, however it was worded.
    if v_ref is not null then
      select r.id into v_reg from public.variation_register r
       where r.project_id = v_entry.project_id
         and upper(regexp_replace(coalesce(r.vr_ref, ''), '\s+', '', 'g')) = v_ref
       limit 1;
    end if;
    -- Otherwise the same words on another day are a further mention, not a new item.
    if v_reg is null then
      select r.id into v_reg from public.variation_register r
       where r.project_id = v_entry.project_id and lower(btrim(r.title)) = v_title
       limit 1;
    end if;

    if v_reg is null then
      insert into public.variation_register (project_id, title, vr_ref, raised_on, estimated_cost)
      values (v_entry.project_id, btrim(v.description), nullif(btrim(coalesce(v.vr_ref, '')), ''),
              v_entry.entry_date, v.estimated_cost)
      returning id into v_reg;
      insert into public.variation_status_events (register_id, status, note)
      values (v_reg, 'raised', 'Raised in the diary on ' || to_char(v_entry.entry_date, 'DD/MM/YYYY'));
    else
      -- A further mention: the item was raised on the earliest day, and a
      -- reference or estimate stated later fills a blank — never overwrites.
      update public.variation_register r
         set raised_on      = least(r.raised_on, v_entry.entry_date),
             vr_ref         = coalesce(r.vr_ref, nullif(btrim(coalesce(v.vr_ref, '')), '')),
             estimated_cost = coalesce(r.estimated_cost, v.estimated_cost)
       where r.id = v_reg;
    end if;

    insert into public.variation_register_links (variation_id, register_id) values (v.id, v_reg);
  end loop;
end;
$$;

create or replace function app.entries_register_variations()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform app.register_variations_for_entry(new.id);
  return null;
end;
$$;

create trigger entries_register_variations
  after update of status on public.entries
  for each row
  when (new.status = 'signed' and old.status <> 'signed')
  execute function app.entries_register_variations();

-- ---------------------------------------------------------------------------
-- The two ways the office writes to it.
-- ---------------------------------------------------------------------------
create or replace function public.set_variation_status(
  p_register_id uuid,
  p_status      public.variation_status,
  p_note        text default null
)
returns public.variation_register
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.variation_register;
begin
  select * into v_row from public.variation_register where id = p_register_id;
  if not found or not app.is_project_member(v_row.project_id) then
    raise exception 'That variation is not on one of your projects.';
  end if;

  update public.variation_register r
     set status       = p_status,
         submitted_on = case when p_status = 'submitted' then coalesce(r.submitted_on, current_date) else r.submitted_on end,
         decided_on   = case when p_status in ('approved', 'rejected') then coalesce(r.decided_on, current_date) else r.decided_on end,
         paid_on      = case when p_status = 'paid' then coalesce(r.paid_on, current_date) else r.paid_on end
   where r.id = p_register_id
   returning * into v_row;

  insert into public.variation_status_events (register_id, status, note, changed_by)
  values (p_register_id, p_status, nullif(btrim(coalesce(p_note, '')), ''), auth.uid());

  return v_row;
end;
$$;

create or replace function public.set_variation_details(
  p_register_id  uuid,
  p_vr_ref       text,
  p_agreed_cost  numeric,
  p_notes        text
)
returns public.variation_register
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.variation_register;
begin
  select * into v_row from public.variation_register where id = p_register_id;
  if not found or not app.is_project_member(v_row.project_id) then
    raise exception 'That variation is not on one of your projects.';
  end if;
  if p_agreed_cost is not null and p_agreed_cost < 0 then
    raise exception 'An agreed value cannot be negative.';
  end if;

  update public.variation_register r
     set vr_ref      = nullif(btrim(coalesce(p_vr_ref, '')), ''),
         agreed_cost = p_agreed_cost,
         notes       = nullif(btrim(coalesce(p_notes, '')), '')
   where r.id = p_register_id
   returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.set_variation_status(uuid, public.variation_status, text) from public;
revoke all on function public.set_variation_details(uuid, text, numeric, text) from public;
grant execute on function public.set_variation_status(uuid, public.variation_status, text) to authenticated, service_role;
grant execute on function public.set_variation_details(uuid, text, numeric, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The diary view carries the row id, so a screen can find the register item
-- a diary mention belongs to. (Appended column; existing selects unaffected.)
-- ---------------------------------------------------------------------------
create or replace view diary.variations with (security_invoker = true) as
select d.entry_no, d.entry_date, d.project_id, d.project_name,
       v.description, v.directed_by, v.directed_at, v.vr_ref, v.estimated_cost,
       coalesce(array_length(v.photo_urls, 1), 0) as photo_count,
       v.id as variation_id
from public.variations v join diary.entries d on d.entry_id = v.entry_id;
grant select on diary.variations to authenticated, service_role;

-- Every variation already signed is registered as of today.
do $$
declare e record;
begin
  for e in select id from public.entries where status = 'signed' order by signed_at loop
    perform app.register_variations_for_entry(e.id);
  end loop;
end;
$$;
