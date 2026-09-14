-- Permits: numbered by the database, issued only over answered controls and
-- two signatures inside a sane window, then frozen; closed only over the
-- close-out checks and a signature; cancelled only with a reason.
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
  ('11111111-1111-1111-1111-111111111111', 'sup@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'lh@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'pm@example.com');
insert into public.organisations (id, name, code) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Kingsbridge Civil', 'KBS');
insert into public.projects (id, org_id, name, code) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Northern', 'C001');
insert into public.project_members (project_id, user_id, role) values
  ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'supervisor'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'leading_hand'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'pm');

-- The leading hand may not raise a permit.
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
set local role authenticated;
select tests.expect_error($q$
  insert into public.permits (project_id, kind, title, valid_from, valid_to, issuer_name, holder_name, issued_by)
  values ('bbbbbbbb-0000-0000-0000-000000000001', 'hot_work', 'LH permit', now(), now() + interval '8 hours', 'LH', 'LH', '22222222-2222-2222-2222-222222222222')
$q$, 'row-level security');

-- The supervisor raises one; it is born open and numbered.
reset role;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;
insert into public.permits (id, project_id, kind, title, valid_from, valid_to, controls, issuer_name, holder_name, issued_by, status, issued_at)
values ('dddddddd-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'hot_work', ' Weld the flange ', now(), now() + interval '8 hours',
        '[{"key":"a","label":"Combustibles clear","result":null},{"key":"b","label":"Extinguisher at hand","result":null}]'::jsonb,
        'Sup', 'Danny Rowe', '11111111-1111-1111-1111-111111111111', 'issued', now());
do $$ declare p public.permits; begin
  select * into p from public.permits where id = 'dddddddd-0000-0000-0000-000000000001';
  assert p.seq = 1 and p.status = 'open' and p.issued_at is null, 'a permit was born issued or unnumbered';
  assert p.title = 'Weld the flange', 'the title was not trimmed';
  raise notice 'PASS  a permit is born open and numbered';
end $$;
-- Issue: refused until every control is answered, and without both signatures in its folder.
select tests.expect_error($q$
  update public.permits set status = 'issued',
    issuer_signature_path = 'bbbbbbbb-0000-0000-0000-000000000001/permit/dddddddd-0000-0000-0000-000000000001/i.png',
    holder_signature_path = 'bbbbbbbb-0000-0000-0000-000000000001/permit/dddddddd-0000-0000-0000-000000000001/h.png'
   where id = 'dddddddd-0000-0000-0000-000000000001'
$q$, 'every control');
update public.permits set controls = '[{"key":"a","label":"Combustibles clear","result":"yes"},{"key":"b","label":"Extinguisher at hand","result":"yes"}]'::jsonb
 where id = 'dddddddd-0000-0000-0000-000000000001';
select tests.expect_error($q$
  update public.permits set status = 'issued',
    issuer_signature_path = 'bbbbbbbb-0000-0000-0000-000000000001/permit/dddddddd-0000-0000-0000-000000000001/i.png'
   where id = 'dddddddd-0000-0000-0000-000000000001'
$q$, 'both sign');
select tests.expect_error($q$
  update public.permits set status = 'issued',
    issuer_signature_path = 'bbbbbbbb-0000-0000-0000-000000000001/permit/dddddddd-0000-0000-0000-000000000001/i.png',
    holder_signature_path = 'bbbbbbbb-0000-0000-0000-000000000001/prestart/x/h.png'
   where id = 'dddddddd-0000-0000-0000-000000000001'
$q$, 'own folder');
update public.permits set status = 'issued',
    issuer_signature_path = 'bbbbbbbb-0000-0000-0000-000000000001/permit/dddddddd-0000-0000-0000-000000000001/i.png',
    holder_signature_path = 'bbbbbbbb-0000-0000-0000-000000000001/permit/dddddddd-0000-0000-0000-000000000001/h.png',
    issued_on_device_at = now() - interval '1 minute'
 where id = 'dddddddd-0000-0000-0000-000000000001';
do $$ declare p public.permits; begin
  select * into p from public.permits where id = 'dddddddd-0000-0000-0000-000000000001';
  assert p.status = 'issued' and p.issued_at >= now() - interval '1 minute', 'issue was not stamped';
  raise notice 'PASS  issued over answered controls and two signatures';
end $$;
-- Issued: frozen.
select tests.expect_error($q$
  update public.permits set valid_to = now() + interval '3 days' where id = 'dddddddd-0000-0000-0000-000000000001'
$q$, 'frozen');
-- A window in the past, or absurd, is refused at issue.
insert into public.permits (id, project_id, kind, title, valid_from, valid_to, controls, issuer_name, holder_name, issued_by)
values ('dddddddd-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000001', 'other', 'Old', now() - interval '10 days', now() - interval '9 days',
        '[{"key":"a","label":"A","result":"na"}]'::jsonb, 'Sup', 'Sam', '11111111-1111-1111-1111-111111111111');
select tests.expect_error($q$
  update public.permits set status = 'issued',
    issuer_signature_path = 'bbbbbbbb-0000-0000-0000-000000000001/permit/dddddddd-0000-0000-0000-000000000002/i.png',
    holder_signature_path = 'bbbbbbbb-0000-0000-0000-000000000001/permit/dddddddd-0000-0000-0000-000000000002/h.png'
   where id = 'dddddddd-0000-0000-0000-000000000002'
$q$, 'already ended');
delete from public.permits where id = 'dddddddd-0000-0000-0000-000000000002';
do $$ begin
  assert not exists (select 1 from public.permits where id = 'dddddddd-0000-0000-0000-000000000002'), 'an unissued permit could not be deleted by its raiser';
  raise notice 'PASS  a window in the past is refused; an unissued permit can be deleted';
end $$;
-- Close: only over the close-out checks and a signature; then frozen.
select tests.expect_error($q$
  update public.permits set status = 'closed', closeout_checks = '[{"key":"x","label":"Area safe","result":null}]'::jsonb,
    closeout_signature_path = 'bbbbbbbb-0000-0000-0000-000000000001/permit/dddddddd-0000-0000-0000-000000000001/c.png'
   where id = 'dddddddd-0000-0000-0000-000000000001'
$q$, 'close-out check');
update public.permits set status = 'closed', closeout_checks = '[{"key":"x","label":"Area safe","result":"yes"}]'::jsonb,
    closeout_signature_path = 'bbbbbbbb-0000-0000-0000-000000000001/permit/dddddddd-0000-0000-0000-000000000001/c.png'
 where id = 'dddddddd-0000-0000-0000-000000000001';
do $$ declare p public.permits; begin
  select * into p from public.permits where id = 'dddddddd-0000-0000-0000-000000000001';
  assert p.status = 'closed' and p.closed_at is not null and p.closed_by = '11111111-1111-1111-1111-111111111111', 'close was not stamped';
end $$;
update public.permits set closeout_note = 'later' where id = 'dddddddd-0000-0000-0000-000000000001';
do $$ begin
  assert (select closeout_note from public.permits where id = 'dddddddd-0000-0000-0000-000000000001') is null, 'a closed permit was edited';
end $$;
reset role;
select tests.expect_error($q$
  update public.permits set closeout_note = 'later' where id = 'dddddddd-0000-0000-0000-000000000001'
$q$, 'frozen');
do $$ begin raise notice 'PASS  closed over checks and a signature, then frozen'; end $$;
-- Cancel needs a reason.
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;
insert into public.permits (id, project_id, kind, title, valid_from, valid_to, controls, issuer_name, holder_name, issued_by)
values ('dddddddd-0000-0000-0000-000000000003', 'bbbbbbbb-0000-0000-0000-000000000001', 'excavation', 'Trench', now(), now() + interval '8 hours',
        '[{"key":"a","label":"A","result":"yes"}]'::jsonb, 'Sup', 'Sam', '11111111-1111-1111-1111-111111111111');
update public.permits set status = 'issued',
    issuer_signature_path = 'bbbbbbbb-0000-0000-0000-000000000001/permit/dddddddd-0000-0000-0000-000000000003/i.png',
    holder_signature_path = 'bbbbbbbb-0000-0000-0000-000000000001/permit/dddddddd-0000-0000-0000-000000000003/h.png'
 where id = 'dddddddd-0000-0000-0000-000000000003';
select tests.expect_error($q$
  update public.permits set status = 'cancelled' where id = 'dddddddd-0000-0000-0000-000000000003'
$q$, 'say why');
update public.permits set status = 'cancelled', cancel_reason = 'Weather' where id = 'dddddddd-0000-0000-0000-000000000003';
do $$ begin
  assert (select status from public.permits where id = 'dddddddd-0000-0000-0000-000000000003') = 'cancelled', 'cancel failed';
  raise notice 'PASS  cancelled with a reason';
end $$;
-- The PM reads and writes nothing.
reset role;
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
set local role authenticated;
do $$ begin assert (select count(*) from public.permits) = 2, 'the PM cannot read permits'; end $$;
update public.permits set cancel_reason = 'PM' where id = 'dddddddd-0000-0000-0000-000000000003';
do $$ begin
  assert (select cancel_reason from public.permits where id = 'dddddddd-0000-0000-0000-000000000003') = 'Weather', 'the PM changed a permit';
  raise notice 'PASS  the PM reads and cannot write';
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

do $$ begin raise notice 'ALL PERMIT TESTS PASSED'; end $$;
rollback;
