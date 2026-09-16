-- ============================================================================
-- Hazardous chemicals register and safety data sheets.
--
-- WHS (General) Regulations 2022 (WA) reg. 346: a person conducting a business
-- or undertaking must prepare and keep AT THE WORKPLACE a register of the
-- hazardous chemicals used, handled or stored there, maintained so the
-- information stays up to date, containing the list AND "the current safety
-- data sheet for each hazardous chemical listed", readily accessible to the
-- workers involved and to anyone else likely to be affected. Regulation 344 is
-- the separate duty to obtain the SDS and give access to it.
--
-- Shaped like the plant register, because it is the same shape: the company
-- keeps each product once (chemical_products) with its safety data sheets over
-- time (chemical_sds), and a job says which of them are on THIS workplace
-- (project_chemicals). One product, many jobs, one vocabulary.
--
-- Two decisions worth stating:
--
--   1. A safety data sheet is a RECORD, not a document that gets overwritten.
--      A new sheet supersedes the old one; the old one is retired and kept, so
--      the register can still answer what the crew was working to in March.
--      Same rule as a subcontractor's certificate.
--
--   2. There is deliberately NO restrictive read policy here. Every other
--      record table got one in 20260915140000 to keep a labourer out. This one
--      is the opposite: reg. 346(3) requires the register be readily accessible
--      to the workers involved in using, handling or storing the chemical, and
--      a labourer is exactly that worker. Locking them out would breach the
--      regulation the table exists to satisfy.
-- ============================================================================

create table public.chemical_products (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organisations (id) on delete restrict,
  name           text not null check (length(btrim(name)) > 0),
  manufacturer   text,
  product_code   text,
  -- The GHS hazard classes named on the label, as the label states them. Never inferred.
  hazard_classes text[] not null default '{}',
  -- Dangerous goods class from the label, e.g. '3' for diesel. Null means none stated.
  dg_class       text,
  -- What it is used for on site, in the crew's words.
  used_for       text,
  notes          text,
  active         boolean not null default true,
  created_by     uuid references auth.users (id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index chemical_products_org_name_idx
  on public.chemical_products (org_id, regexp_replace(lower(btrim(name)), '\s+', ' ', 'g'));

create table public.chemical_sds (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references public.chemical_products (id) on delete restrict,
  -- The date printed on the sheet. A sheet must be reviewed at least every five
  -- years, so this is what decides whether the register holds a CURRENT sheet.
  issued_on   date not null,
  version     text,
  file_path   text,
  notes       text,
  active      boolean not null default true,
  created_by  uuid references auth.users (id),
  created_at  timestamptz not null default now()
);
create index chemical_sds_idx on public.chemical_sds (product_id, active, issued_on desc);

create table public.project_chemicals (
  project_id  uuid not null references public.projects (id) on delete restrict,
  product_id  uuid not null references public.chemical_products (id) on delete restrict,
  -- Where it is kept on this workplace, and roughly how much. Both plain text:
  -- the regulation asks what is here, not for a stocktake.
  location    text,
  quantity    text,
  active      boolean not null default true,
  created_by  uuid references auth.users (id),
  created_at  timestamptz not null default now(),
  primary key (project_id, product_id)
);

create or replace function app.chemical_products_touch()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.name := regexp_replace(btrim(new.name), '\s+', ' ', 'g');
  new.updated_at := now();
  return new;
end; $$;
create trigger a_chemical_products_touch before insert or update on public.chemical_products
  for each row execute function app.chemical_products_touch();

-- A safety data sheet's facts are fixed once recorded; it is retired, not rewritten.
create or replace function app.chemical_sds_before_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.product_id is distinct from old.product_id or new.issued_on is distinct from old.issued_on
     or new.version is distinct from old.version or new.file_path is distinct from old.file_path
     or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception 'A safety data sheet is retired and replaced, not rewritten.' using errcode = 'check_violation';
  end if;
  return new;
end; $$;
create trigger a_chemical_sds_before_update before update on public.chemical_sds
  for each row execute function app.chemical_sds_before_update();
create trigger a_chemical_sds_no_delete before delete on public.chemical_sds
  for each row execute function app.frozen_row();

create or replace function app.chemical_product_org(p_product uuid)
returns uuid language sql stable security definer set search_path = ''
as $$ select org_id from public.chemical_products where id = p_product; $$;
grant execute on function app.chemical_product_org(uuid) to authenticated;

alter table public.chemical_products enable row level security;
alter table public.chemical_sds enable row level security;
alter table public.project_chemicals enable row level security;

-- Reading: anyone in the organisation, every role. See decision 2 above.
create policy chemical_products_select_org on public.chemical_products
  for select to authenticated using (app.is_org_member(org_id));
create policy chemical_products_write_managers on public.chemical_products
  for all to authenticated using (app.can_manage_crew(org_id)) with check (app.can_manage_crew(org_id));

create policy chemical_sds_select_org on public.chemical_sds
  for select to authenticated using (app.is_org_member(app.chemical_product_org(product_id)));
create policy chemical_sds_insert_managers on public.chemical_sds
  for insert to authenticated with check (app.can_manage_crew(app.chemical_product_org(product_id)));
create policy chemical_sds_retire_managers on public.chemical_sds
  for update to authenticated using (app.can_manage_crew(app.chemical_product_org(product_id)))
  with check (app.can_manage_crew(app.chemical_product_org(product_id)));

-- What is on THIS workplace: read by every member, kept by whoever runs the site.
create policy project_chemicals_select_member on public.project_chemicals
  for select to authenticated using (app.is_project_member(project_id));
create policy project_chemicals_write_crew on public.project_chemicals
  for all to authenticated using (app.can_run_talks(project_id)) with check (app.can_run_talks(project_id));

grant select, insert, update on public.chemical_products, public.chemical_sds to authenticated;
grant select, insert, update, delete on public.project_chemicals to authenticated;
grant all on public.chemical_products, public.chemical_sds, public.project_chemicals to service_role;

-- The sheets themselves: {org_id}/{product_id}/{sds_id}.{ext}
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chemical-sds', 'chemical-sds', false, 20971520,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'])
on conflict (id) do nothing;
create policy "safety data sheets readable by the organisation" on storage.objects
  for select to authenticated
  using (bucket_id = 'chemical-sds' and app.is_org_member(((storage.foldername(name))[1])::uuid));
create policy "safety data sheets writable by crew managers" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'chemical-sds' and app.can_manage_crew(((storage.foldername(name))[1])::uuid));
