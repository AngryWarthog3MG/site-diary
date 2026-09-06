-- ============================================================================
-- 20260907092300_variation_register_numbers.sql
-- Every variation gets a number the day it is written down, signed or not.
--
-- Two changes to the register (092200):
--
-- 1. Registration happens when a variation row is written into a diary, not
--    only at signing. A variation the supervisor dictated this afternoon is
--    trackable this afternoon; the card says "not yet signed" until it is.
--    The review screen rewrites a draft's rows on every save (delete, then
--    insert), so matching is by VR reference or identical wording: the row
--    comes back, finds its item, and relinks. An item left with no mention at
--    all — the supervisor removed the variation from the draft — stays, marked
--    as such, until someone removes it; nothing is deleted behind their back.
--
-- 2. A running number per project (V-001, V-002, …), issued once at creation
--    and never reused, so the office can talk about "V-007" before the client
--    has given it a reference of their own. Kept separately from vr_ref, which
--    remains the client's number.
-- ============================================================================

alter table public.projects
  add column next_variation_seq integer not null default 1 check (next_variation_seq >= 1);
comment on column public.projects.next_variation_seq is
  'Next register number for a variation on this project. Issued at creation, never reused.';

alter table public.variation_register add column seq integer;
alter table public.variation_register
  add constraint variation_register_project_seq_key unique (project_id, seq);

create or replace function app.variation_register_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.seq is null then
    update public.projects
       set next_variation_seq = next_variation_seq + 1
     where id = new.project_id
     returning next_variation_seq - 1 into new.seq;
  end if;
  return new;
end;
$$;

create trigger variation_register_number
  before insert on public.variation_register
  for each row execute function app.variation_register_number();

-- Number what is already there, in the order it was raised.
do $$
declare
  r record;
  n integer;
  p uuid := null;
begin
  for r in
    select id, project_id from public.variation_register
     order by project_id, raised_on, created_at
  loop
    if p is distinct from r.project_id then
      p := r.project_id;
      n := 0;
    end if;
    n := n + 1;
    update public.variation_register set seq = n where id = r.id;
    update public.projects set next_variation_seq = n + 1 where id = r.project_id;
  end loop;
end;
$$;
alter table public.variation_register alter column seq set not null;

-- ---------------------------------------------------------------------------
-- Registration per row, so a draft's variations register as they are saved.
-- ---------------------------------------------------------------------------
create or replace function app.register_variation_row(p_variation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v       record;
  v_entry record;
  v_reg   uuid;
  v_ref   text;
  v_title text;
begin
  select * into v from public.variations where id = p_variation_id;
  if not found then return; end if;
  if exists (select 1 from public.variation_register_links l where l.variation_id = v.id) then return; end if;
  select id, project_id, entry_date into v_entry from public.entries where id = v.entry_id;
  if not found then return; end if;

  v_ref   := nullif(upper(regexp_replace(coalesce(v.vr_ref, ''), '\s+', '', 'g')), '');
  v_title := lower(btrim(v.description));
  v_reg   := null;

  if v_ref is not null then
    select r.id into v_reg from public.variation_register r
     where r.project_id = v_entry.project_id
       and upper(regexp_replace(coalesce(r.vr_ref, ''), '\s+', '', 'g')) = v_ref
     limit 1;
  end if;
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
    update public.variation_register r
       set raised_on      = least(r.raised_on, v_entry.entry_date),
           vr_ref         = coalesce(r.vr_ref, nullif(btrim(coalesce(v.vr_ref, '')), '')),
           estimated_cost = coalesce(r.estimated_cost, v.estimated_cost)
     where r.id = v_reg;
  end if;

  insert into public.variation_register_links (variation_id, register_id) values (v.id, v_reg);
end;
$$;

create or replace function app.register_variations_for_entry(p_entry_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare r record;
begin
  for r in select id from public.variations where entry_id = p_entry_id loop
    perform app.register_variation_row(r.id);
  end loop;
end;
$$;

create or replace function app.variations_register_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform app.register_variation_row(new.id);
  return null;
end;
$$;

create trigger variations_register
  after insert on public.variations
  for each row execute function app.variations_register_row();

-- ---------------------------------------------------------------------------
-- Removing an item that no signed diary stands behind.
-- ---------------------------------------------------------------------------
create or replace function public.remove_variation_item(p_register_id uuid)
returns void
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
  if exists (
    select 1 from public.variation_register_links l
      join public.variations v on v.id = l.variation_id
      join public.entries e on e.id = v.entry_id
     where l.register_id = p_register_id and e.status = 'signed'
  ) then
    raise exception 'A signed diary records this variation; it cannot be removed from the register.';
  end if;
  delete from public.variation_register where id = p_register_id;
end;
$$;
revoke all on function public.remove_variation_item(uuid) from public;
grant execute on function public.remove_variation_item(uuid) to authenticated, service_role;

-- Every variation already in a draft is registered as of today.
do $$
declare r record;
begin
  for r in
    select var.id from public.variations var
     where not exists (select 1 from public.variation_register_links l where l.variation_id = var.id)
     order by var.created_at
  loop
    perform app.register_variation_row(r.id);
  end loop;
end;
$$;
