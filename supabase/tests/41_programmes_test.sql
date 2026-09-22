-- The programme: kept by the supervisor and the office, read by every member behind the record lock, never rewritten,
-- voided with a reason once; a look-ahead names its fortnight; a file sits in its own job's folder.
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
create function tests.n(p_sql text) returns integer language plpgsql as $$
declare r integer; begin execute p_sql into r; return r; end; $$;

insert into auth.users (id, email) values
  ('11111111-9999-0000-0000-000000000001', 'sup.prog@example.com'),
  ('11111111-9999-0000-0000-000000000002', 'lh.prog@example.com'),
  ('11111111-9999-0000-0000-000000000003', 'lab.prog@example.com'),
  ('11111111-9999-0000-0000-000000000004', 'outsider.prog@example.com');
insert into public.organisations (id, name, code) values ('aaaaaaaa-9999-0000-0000-000000000001', 'Programme Civil', 'PRC');
insert into public.projects (id, org_id, name, code) values
  ('bbbbbbbb-9999-0000-0000-000000000001', 'aaaaaaaa-9999-0000-0000-000000000001', 'Programme Job', 'P101'),
  ('bbbbbbbb-9999-0000-0000-000000000002', 'aaaaaaaa-9999-0000-0000-000000000001', 'Other Job', 'P102');
insert into public.project_members (project_id, user_id, role) values
  ('bbbbbbbb-9999-0000-0000-000000000001', '11111111-9999-0000-0000-000000000001', 'supervisor'),
  ('bbbbbbbb-9999-0000-0000-000000000001', '11111111-9999-0000-0000-000000000002', 'leading_hand'),
  ('bbbbbbbb-9999-0000-0000-000000000001', '11111111-9999-0000-0000-000000000003', 'labourer'),
  ('bbbbbbbb-9999-0000-0000-000000000002', '11111111-9999-0000-0000-000000000004', 'admin');

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-9999-0000-0000-000000000001","role":"authenticated"}';

-- The supervisor uploads the baseline and a look-ahead; the DB stamps who; a title is tidied.
insert into public.project_programmes (id, project_id, kind, title, revision, issued_on, file_path, content_type, size_bytes, uploaded_by)
values ('cccccccc-9999-0000-0000-000000000001', 'bbbbbbbb-9999-0000-0000-000000000001', 'baseline', '  Construction  programme ', '0', '2026-06-17',
        'bbbbbbbb-9999-0000-0000-000000000001/cccccccc-9999-0000-0000-000000000001.pdf', 'application/pdf', 123456, '11111111-9999-0000-0000-000000000004');
insert into public.project_programmes (id, project_id, kind, title, period_start, period_end, file_path)
values ('cccccccc-9999-0000-0000-000000000002', 'bbbbbbbb-9999-0000-0000-000000000001', 'lookahead', 'Two-week look-ahead', '2026-09-21', '2026-10-04',
        'bbbbbbbb-9999-0000-0000-000000000001/cccccccc-9999-0000-0000-000000000002.pdf');
do $$
declare r record;
begin
  select * into r from public.project_programmes where id = 'cccccccc-9999-0000-0000-000000000001';
  if r.title <> 'Construction programme' then raise exception 'TESTFAIL: title not tidied: "%"', r.title; end if;
  if r.uploaded_by <> '11111111-9999-0000-0000-000000000001' then raise exception 'TESTFAIL: uploaded_by should be the caller, is %', r.uploaded_by; end if;
  if r.voided_at is not null then raise exception 'TESTFAIL: born live'; end if;
end; $$;

-- A look-ahead names its fortnight; a file sits in its own job's folder.
select tests.expect_error($$
  insert into public.project_programmes (project_id, kind, title, file_path) values ('bbbbbbbb-9999-0000-0000-000000000001', 'lookahead', 'No dates', 'bbbbbbbb-9999-0000-0000-000000000001/x.pdf')
$$, 'lookahead_period');
select tests.expect_error($$
  insert into public.project_programmes (project_id, kind, title, period_start, period_end, file_path) values ('bbbbbbbb-9999-0000-0000-000000000001', 'lookahead', 'Backwards', '2026-10-04', '2026-09-21', 'bbbbbbbb-9999-0000-0000-000000000001/y.pdf')
$$, 'lookahead_period');
select tests.expect_error($$
  insert into public.project_programmes (project_id, kind, title, file_path) values ('bbbbbbbb-9999-0000-0000-000000000001', 'baseline', 'Elsewhere', 'bbbbbbbb-9999-0000-0000-000000000002/z.pdf')
$$, 'own job');

-- Never rewritten: only voiding, with a reason, once.
select tests.expect_error($$
  update public.project_programmes set title = 'Renamed' where id = 'cccccccc-9999-0000-0000-000000000001'
$$, 'never rewritten');
select tests.expect_error($$
  update public.project_programmes set voided_at = now() where id = 'cccccccc-9999-0000-0000-000000000001'
$$, 'void_reason');
update public.project_programmes set voided_at = now(), void_reason = 'Wrong file' where id = 'cccccccc-9999-0000-0000-000000000001';
select tests.expect_error($$
  update public.project_programmes set voided_at = now(), void_reason = 'Again' where id = 'cccccccc-9999-0000-0000-000000000001'
$$, 'already voided');
reset role;
select tests.expect_error($$ delete from public.project_programmes where id = 'cccccccc-9999-0000-0000-000000000001' $$, 'never changed or removed');
set local role authenticated;

-- The leading hand reads both; cannot upload or void. The labourer reads none. Another company's admin reads none.
set local request.jwt.claims = '{"sub":"11111111-9999-0000-0000-000000000002","role":"authenticated"}';
do $$
begin
  if tests.n('select count(*) from public.project_programmes') <> 2 then raise exception 'TESTFAIL: the leading hand should read both'; end if;
end; $$;
select tests.expect_error($$
  insert into public.project_programmes (project_id, kind, title, file_path) values ('bbbbbbbb-9999-0000-0000-000000000001', 'baseline', 'Mine', 'bbbbbbbb-9999-0000-0000-000000000001/m.pdf')
$$, 'row-level security');
do $$
declare n integer;
begin
  update public.project_programmes set voided_at = now(), void_reason = 'lh' where id = 'cccccccc-9999-0000-0000-000000000002';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'TESTFAIL: the leading hand voided a programme'; end if;
end; $$;
set local request.jwt.claims = '{"sub":"11111111-9999-0000-0000-000000000003","role":"authenticated"}';
do $$
begin
  if tests.n('select count(*) from public.project_programmes') <> 0 then raise exception 'TESTFAIL: the labourer read the programme'; end if;
end; $$;
set local request.jwt.claims = '{"sub":"11111111-9999-0000-0000-000000000004","role":"authenticated"}';
do $$
begin
  if tests.n('select count(*) from public.project_programmes') <> 0 then raise exception 'TESTFAIL: another job''s admin read the programme'; end if;
end; $$;

rollback;
