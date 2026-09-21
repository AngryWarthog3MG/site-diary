-- Templates are company data: every member of the company reads them, the office writes them, nobody deletes them,
-- and a company's items never move to another company. A document names its folder; a par level needs a unit.
begin;
create schema tests;
grant usage on schema tests to public;
create function tests.expect_error(p_sql text, p_fragment text)
returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'TESTFAIL: expected failure but statement succeeded: %', p_sql;
exception
  when others then
    if sqlerrm like 'TESTFAIL:%' then raise; end if;
    if position(lower(p_fragment) in lower(sqlerrm)) = 0 then
      raise exception 'TESTFAIL: wrong error for [%] — got "%", expected "%"', p_sql, sqlerrm, p_fragment;
    end if;
end;
$$;

insert into auth.users (id, email) values
  ('11111111-6666-0000-0000-000000000001', 'pm.tpl@example.com'),
  ('11111111-6666-0000-0000-000000000002', 'sup.tpl@example.com'),
  ('11111111-6666-0000-0000-000000000003', 'outsider.tpl@example.com');
insert into public.organisations (id, name, code) values
  ('aaaaaaaa-6666-0000-0000-000000000001', 'Template Civil', 'TPC'),
  ('aaaaaaaa-6666-0000-0000-000000000002', 'Other Civil', 'OTC');
insert into public.projects (id, org_id, name, code) values
  ('bbbbbbbb-6666-0000-0000-000000000001', 'aaaaaaaa-6666-0000-0000-000000000001', 'Template Job', 'T101'),
  ('bbbbbbbb-6666-0000-0000-000000000002', 'aaaaaaaa-6666-0000-0000-000000000002', 'Other Job', 'O101');
insert into public.project_members (project_id, user_id, role) values
  ('bbbbbbbb-6666-0000-0000-000000000001', '11111111-6666-0000-0000-000000000001', 'pm'),
  ('bbbbbbbb-6666-0000-0000-000000000001', '11111111-6666-0000-0000-000000000002', 'supervisor'),
  ('bbbbbbbb-6666-0000-0000-000000000002', '11111111-6666-0000-0000-000000000003', 'admin');
-- The module shells, as the migration gives every company.
insert into public.template_modules (org_id, key, name, sort) values
  ('aaaaaaaa-6666-0000-0000-000000000001', 'core', 'Core', 10),
  ('aaaaaaaa-6666-0000-0000-000000000001', 'earthworks', 'Earthworks', 20);

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-6666-0000-0000-000000000001","role":"authenticated"}';

-- The PM fills the library.
insert into public.template_items (id, org_id, module_key, kind, category, title, priority, min_tier, owner_role)
values ('cccccccc-6666-0000-0000-000000000001', 'aaaaaaaa-6666-0000-0000-000000000001', 'core', 'start_gate', 'Contract', '  Signed contract or  LOI on file ', 'A', 'light', 'office');
insert into public.template_items (org_id, module_key, kind, category, title, unit, par_level)
values ('aaaaaaaa-6666-0000-0000-000000000001', 'earthworks', 'consumable', '15 Site consumables', 'Marking paint', 'cans', 6);
insert into public.template_items (org_id, module_key, kind, title, folder_no)
values ('aaaaaaaa-6666-0000-0000-000000000001', 'core', 'document', 'Public liability certificate of currency', 5);

do $$
declare t text; n integer;
begin
  select title into t from public.template_items where id = 'cccccccc-6666-0000-0000-000000000001';
  if t <> 'Signed contract or LOI on file' then raise exception 'TESTFAIL: title not tidied, got "%"', t; end if;
  select count(*) into n from public.template_items where org_id = 'aaaaaaaa-6666-0000-0000-000000000001';
  if n <> 3 then raise exception 'TESTFAIL: expected 3 items, read %', n; end if;
end; $$;

-- A document must name its folder; a par level needs a unit; a module must exist.
select tests.expect_error($$
  insert into public.template_items (org_id, module_key, kind, title) values ('aaaaaaaa-6666-0000-0000-000000000001', 'core', 'document', 'Nowhere to file it')
$$, 'names its folder');
select tests.expect_error($$
  insert into public.template_items (org_id, module_key, kind, title, par_level) values ('aaaaaaaa-6666-0000-0000-000000000001', 'core', 'consumable', 'Tape', 3)
$$, 'needs a unit');
select tests.expect_error($$
  insert into public.template_items (org_id, module_key, kind, title) values ('aaaaaaaa-6666-0000-0000-000000000001', 'plumbing', 'start_gate', 'x')
$$, 'foreign key');

-- Retired, never deleted; and it stays with its company.
update public.template_items set active = false where id = 'cccccccc-6666-0000-0000-000000000001';
reset role;
select tests.expect_error($$
  delete from public.template_items where id = 'cccccccc-6666-0000-0000-000000000001'
$$, 'never changed or removed');
select tests.expect_error($$
  update public.template_items set org_id = 'aaaaaaaa-6666-0000-0000-000000000002' where id = 'cccccccc-6666-0000-0000-000000000001'
$$, 'stays with its company');
set local role authenticated;

-- The supervisor reads the library and cannot write it.
set local request.jwt.claims = '{"sub":"11111111-6666-0000-0000-000000000002","role":"authenticated"}';
do $$
declare n integer;
begin
  select count(*) into n from public.template_items where org_id = 'aaaaaaaa-6666-0000-0000-000000000001';
  if n <> 3 then raise exception 'TESTFAIL: a supervisor should read the company''s templates, read %', n; end if;
end; $$;
select tests.expect_error($$
  insert into public.template_items (org_id, module_key, kind, title) values ('aaaaaaaa-6666-0000-0000-000000000001', 'core', 'risk', 'Not mine to write')
$$, 'row-level security');

-- Another company's admin sees none of it.
set local request.jwt.claims = '{"sub":"11111111-6666-0000-0000-000000000003","role":"authenticated"}';
do $$
declare n integer;
begin
  select count(*) into n from public.template_items where org_id = 'aaaaaaaa-6666-0000-0000-000000000001';
  if n <> 0 then raise exception 'TESTFAIL: another company read % template item(s)', n; end if;
  select count(*) into n from public.template_modules where org_id = 'aaaaaaaa-6666-0000-0000-000000000001';
  if n <> 0 then raise exception 'TESTFAIL: another company read the modules'; end if;
end; $$;

rollback;
