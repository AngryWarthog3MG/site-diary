-- One person, one row on the timesheet (README R107). "Matty and Mathew are the same person, so combine their hours."
-- A job's crew list already knows its own nicknames (crew.aliases), but a job with no crew list — Deep Green Pad —
-- wrote "Matt Rodgers", and the company timesheet showed him twice. This is the company's list of names that are one
-- person: an alias and the name it is. Office keeps it; everyone who reads the records reads it. Deleting a line undoes
-- a combination; nothing in the record changes either way — the diary keeps the name as it was said.

create table public.person_aliases (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organisations (id) on delete cascade,
  alias       text not null check (btrim(alias) <> ''),
  name        text not null check (btrim(name) <> ''),
  note        text,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  constraint person_aliases_not_itself check (lower(btrim(alias)) <> lower(btrim(name)))
);
create unique index person_aliases_one_per_alias on public.person_aliases (org_id, lower(alias));

create or replace function app.person_aliases_tidy()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.alias := btrim(regexp_replace(new.alias, '\s+', ' ', 'g'));
  new.name := btrim(regexp_replace(new.name, '\s+', ' ', 'g'));
  new.note := nullif(btrim(coalesce(new.note, '')), '');
  if lower(new.alias) = lower(new.name) then
    raise exception 'A name cannot be combined with itself.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger person_aliases_tidy before insert or update on public.person_aliases
  for each row execute function app.person_aliases_tidy();

alter table public.person_aliases enable row level security;
create policy person_aliases_select on public.person_aliases for select to authenticated using (app.reads_org_record(org_id));
create policy person_aliases_insert on public.person_aliases for insert to authenticated with check (app.is_org_office(org_id));
create policy person_aliases_delete on public.person_aliases for delete to authenticated using (app.is_org_office(org_id));
grant select, insert, delete on public.person_aliases to authenticated;
grant all on public.person_aliases to service_role;
