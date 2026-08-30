-- ============================================================================
-- supabase/tests/01_schema_test.sql
--
-- Covers the step-1 guarantees:
--   * entry numbers are issued at signing, per project, with no gaps
--   * a signed entry cannot be updated or deleted (brief §10)
--   * child rows of a signed entry cannot be inserted, updated or deleted
--   * content_hash is written on signing and verifies afterwards
--   * the canonical JSON is content-determined, not insert-order-determined
--   * blocking gaps prevent signing
--   * corrections are made by superseding, and are exempt from the
--     one-entry-per-author-per-day rule
--   * abandoned drafts consume no serial
--   * RLS: PMs are read-only, non-members see nothing
--
-- Run against a local stack:
--     supabase db reset
--     psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/01_schema_test.sql
--
-- The whole file runs in one transaction and rolls back; it leaves no data.
-- ============================================================================

begin;

create schema tests;
grant usage on schema tests to public;

-- Assert that a statement fails, and that it fails for the expected reason.
create function tests.expect_error(p_sql text, p_fragment text)
returns void
language plpgsql
as $$
begin
  execute p_sql;
  raise exception 'TESTFAIL: expected failure but statement succeeded: %', p_sql;
exception
  when others then
    if sqlerrm like 'TESTFAIL:%' then
      raise;
    end if;
    if position(lower(p_fragment) in lower(sqlerrm)) = 0 then
      raise exception 'TESTFAIL: wrong error for [%] — got "%", expected to contain "%"',
        p_sql, sqlerrm, p_fragment;
    end if;
end;
$$;

-- Authentication is impersonated exactly as PostgREST does it: set the JWT
-- claims GUC, then SET LOCAL ROLE authenticated. Both are written inline
-- rather than wrapped in a helper, because SET LOCAL inside a function has
-- scoping rules that differ depending on the function's own SET clause.

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'sup1@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'sup2@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'pm@example.com'),
  ('44444444-4444-4444-4444-444444444444', 'outsider@example.com');

insert into public.organisations (id, name, code)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'Kingsbridge Civil', 'KBS');

insert into public.projects (id, org_id, name, code)
values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   'Northern Interchange', 'C001'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001',
   'Other Site', 'C002');

insert into public.project_members (project_id, user_id, role) values
  ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'supervisor'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'supervisor'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'pm'),
  ('bbbbbbbb-0000-0000-0000-000000000002', '44444444-4444-4444-4444-444444444444', 'supervisor');

-- ---------------------------------------------------------------------------
-- 1. Drafts carry no serial
-- ---------------------------------------------------------------------------
insert into public.entries (id, project_id, entry_date, author_id) values
  ('cccccccc-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001',
   date '2026-08-24', '11111111-1111-1111-1111-111111111111'),
  ('cccccccc-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000001',
   date '2026-08-25', '11111111-1111-1111-1111-111111111111');

do $$
begin
  -- Scoped to the fixture's projects: hosted runs share the database with
  -- real signed entries, whose serials are none of this test's business.
  assert (select count(*) from public.entries
           where (entry_no is not null or entry_seq is not null)
             and project_id in ('bbbbbbbb-0000-0000-0000-000000000001',
                                'bbbbbbbb-0000-0000-0000-000000000002')) = 0,
         'a draft was issued a serial';
  assert (select next_entry_seq from public.projects
           where id = 'bbbbbbbb-0000-0000-0000-000000000001') = 1,
         'draft creation advanced the counter';
  assert app.project_next_entry_no('bbbbbbbb-0000-0000-0000-000000000001')
         ~ '^KBS-\d{4}-\d{2}-\d{2}$', 'provisional reference is not org-date shaped';
  assert app.project_next_entry_no('bbbbbbbb-0000-0000-0000-000000000001', date '2026-08-24')
         = 'KBS-2026-08-24', 'provisional reference for a given date wrong';
  raise notice 'PASS  drafts carry no serial; counter untouched';
end;
$$;

-- A client cannot claim a serial for itself.
select tests.expect_error($q$
  insert into public.entries (project_id, entry_date, author_id, entry_seq, entry_no)
  values ('bbbbbbbb-0000-0000-0000-000000000001', date '2026-08-23',
          '11111111-1111-1111-1111-111111111111', 7, 'KBS-2099-01-01')
$q$, 'entries_signature_complete');

select tests.expect_error($q$
  update public.entries set entry_no = 'KBS-C001-999'
   where id = 'cccccccc-0000-0000-0000-000000000002'
$q$, 'issued on signing');

do $$ begin raise notice 'PASS  a serial cannot be client-supplied'; end; $$;

insert into public.entries (id, project_id, entry_date, author_id) values
  ('cccccccc-0000-0000-0000-000000000009', 'bbbbbbbb-0000-0000-0000-000000000002',
   date '2026-08-25', '44444444-4444-4444-4444-444444444444');

-- One original entry per author per day.
select tests.expect_error($q$
  insert into public.entries (project_id, entry_date, author_id)
  values ('bbbbbbbb-0000-0000-0000-000000000001', date '2026-08-25',
          '11111111-1111-1111-1111-111111111111')
$q$, 'entries_one_original_per_author_per_day');

-- A second supervisor on the same day is fine.
insert into public.entries (id, project_id, entry_date, author_id)
values ('cccccccc-0000-0000-0000-000000000003', 'bbbbbbbb-0000-0000-0000-000000000001',
        date '2026-08-25', '22222222-2222-2222-2222-222222222222');

do $$ begin raise notice 'PASS  one original per author per day'; end; $$;

-- ---------------------------------------------------------------------------
-- 2. Blocking gaps prevent signing
-- ---------------------------------------------------------------------------
insert into public.pours (entry_id, location, mix_spec)
values ('cccccccc-0000-0000-0000-000000000001', 'Pier 3 blinding', '32 MPa');

do $$
begin
  assert app.entry_blocking_gaps('cccccccc-0000-0000-0000-000000000001')
         = array['pour_missing_volume_m3'], 'gap not detected';
end;
$$;

select tests.expect_error($q$
  update public.entries set status = 'signed'
   where id = 'cccccccc-0000-0000-0000-000000000001'
$q$, 'pour_missing_volume_m3');

update public.pours set volume_m3 = 18.50
 where entry_id = 'cccccccc-0000-0000-0000-000000000001';

-- A variation needs both a VR reference and a photo.
insert into public.variations (entry_id, description)
values ('cccccccc-0000-0000-0000-000000000001', 'Extra rock breaking at Pier 3');

select tests.expect_error($q$
  update public.entries set status = 'signed'
   where id = 'cccccccc-0000-0000-0000-000000000001'
$q$, 'variation_missing_vr_ref');

update public.variations
   set vr_ref = 'VR-014',
       photo_urls = array['bbbbbbbb-0000-0000-0000-000000000001/cccccccc-0000-0000-0000-000000000001/vr014.jpg']
 where entry_id = 'cccccccc-0000-0000-0000-000000000001';

-- A delay needs a start and an end.
insert into public.delays (entry_id, start_time, cause, category)
values ('cccccccc-0000-0000-0000-000000000001', time '09:30', 'Rain', 'weather');

select tests.expect_error($q$
  update public.entries set status = 'signed'
   where id = 'cccccccc-0000-0000-0000-000000000001'
$q$, 'delay_missing_times');

update public.delays set end_time = time '11:15', duration_mins = 105
 where entry_id = 'cccccccc-0000-0000-0000-000000000001';

do $$ begin raise notice 'PASS  blocking gaps prevent signing'; end; $$;

-- ---------------------------------------------------------------------------
-- 3. Signing writes a verifiable content hash
-- ---------------------------------------------------------------------------
insert into public.labour (entry_id, person_name, role, hours, source_quote, confidence)
values
  ('cccccccc-0000-0000-0000-000000000001', 'Danny Rowe',  'leading hand', 9.00,
   'Danny and Sam on the pier all day', 'high'),
  ('cccccccc-0000-0000-0000-000000000001', 'Sam Whitely', 'labourer',     8.50,
   'Danny and Sam on the pier all day', 'high');

insert into public.entry_sections (entry_id, section, state) values
  ('cccccccc-0000-0000-0000-000000000001', 'labour',     'captured'),
  ('cccccccc-0000-0000-0000-000000000001', 'plant',      'nil_confirmed'),
  ('cccccccc-0000-0000-0000-000000000001', 'work_items', 'captured'),
  ('cccccccc-0000-0000-0000-000000000001', 'variations', 'captured'),
  ('cccccccc-0000-0000-0000-000000000001', 'delays',     'captured'),
  ('cccccccc-0000-0000-0000-000000000001', 'weather',    'captured');

insert into public.weather (entry_id, temp_max, temp_min, rainfall_mm, source)
values ('cccccccc-0000-0000-0000-000000000001', 21.40, 9.80, 12.60, 'bom_auto');

update public.entries set status = 'signed'
 where id = 'cccccccc-0000-0000-0000-000000000001';

do $$
declare r public.entries;
begin
  select * into r from public.entries where id = 'cccccccc-0000-0000-0000-000000000001';
  assert r.status = 'signed',                  'status not signed';
  assert r.entry_seq = 1,                      'serial not issued on signing';
  assert r.entry_no = 'KBS-2026-08-24',     format('entry_no is %s', r.entry_no);
  assert r.signed_at is not null,              'signed_at not set';
  assert r.signed_by = r.author_id,            'signed_by defaulted wrong';
  assert r.content_hash ~ '^[0-9a-f]{64}$',    'content_hash malformed';
  assert app.verify_entry_hash(r.id),          'stored hash does not verify';
  assert (select next_entry_seq from public.projects
           where id = 'bbbbbbbb-0000-0000-0000-000000000001') = 2, 'counter not advanced';
  raise notice 'PASS  signing issues the serial and a verifiable hash (% / %)',
               r.entry_no, left(r.content_hash, 12);
end;
$$;

-- Numbering is per project, not global: the other project starts at 001 too.
insert into public.pours (entry_id, location, volume_m3)
values ('cccccccc-0000-0000-0000-000000000009', 'Slab A', 6.00);
update public.entries set status = 'signed'
 where id = 'cccccccc-0000-0000-0000-000000000009';

do $$
begin
  assert (select entry_no from public.entries where id = 'cccccccc-0000-0000-0000-000000000009')
         = 'KBS-2026-08-25', 'reference should be the org and the entry''s date';
  raise notice 'PASS  numbering is per project';
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Signed entries are immutable (brief §10)
-- ---------------------------------------------------------------------------
select tests.expect_error($q$
  update public.entries set transcript_raw = 'tampered'
   where id = 'cccccccc-0000-0000-0000-000000000001'
$q$, 'is signed and cannot be modified');

select tests.expect_error($q$
  update public.entries set status = 'draft'
   where id = 'cccccccc-0000-0000-0000-000000000001'
$q$, 'is signed and cannot be modified');

select tests.expect_error($q$
  delete from public.entries where id = 'cccccccc-0000-0000-0000-000000000001'
$q$, 'is signed and cannot be deleted');

select tests.expect_error($q$
  update public.labour set hours = 99
   where entry_id = 'cccccccc-0000-0000-0000-000000000001'
$q$, 'is signed and immutable');

select tests.expect_error($q$
  delete from public.labour where entry_id = 'cccccccc-0000-0000-0000-000000000001'
$q$, 'is signed and immutable');

select tests.expect_error($q$
  insert into public.labour (entry_id, person_name, hours)
  values ('cccccccc-0000-0000-0000-000000000001', 'Ghost Worker', 8)
$q$, 'is signed and immutable');

select tests.expect_error($q$
  update public.weather set rainfall_mm = 0
   where entry_id = 'cccccccc-0000-0000-0000-000000000001'
$q$, 'is signed and immutable');

-- Nor can a child row be moved onto a signed entry from a draft.
insert into public.labour (id, entry_id, person_name, hours)
values ('dddddddd-0000-0000-0000-000000000001',
        'cccccccc-0000-0000-0000-000000000002', 'Kel Brady', 7.5);

select tests.expect_error($q$
  update public.labour set entry_id = 'cccccccc-0000-0000-0000-000000000001'
   where id = 'dddddddd-0000-0000-0000-000000000001'
$q$, 'is signed and immutable');

do $$ begin raise notice 'PASS  signed entries and their children are immutable'; end; $$;

-- Drafts are still freely editable and deletable.
update public.entries set transcript_raw = 'testing one two'
 where id = 'cccccccc-0000-0000-0000-000000000003';
delete from public.entries where id = 'cccccccc-0000-0000-0000-000000000003';

do $$ begin raise notice 'PASS  drafts remain editable and deletable'; end; $$;

-- Identity columns of a draft are pinned.
select tests.expect_error($q$
  update public.entries set project_id = 'bbbbbbbb-0000-0000-0000-000000000002'
   where id = 'cccccccc-0000-0000-0000-000000000002'
$q$, 'identity columns');

select tests.expect_error($q$
  update public.entries set author_id = '22222222-2222-2222-2222-222222222222'
   where id = 'cccccccc-0000-0000-0000-000000000002'
$q$, 'identity columns');

do $$ begin raise notice 'PASS  draft identity columns are pinned'; end; $$;

-- ---------------------------------------------------------------------------
-- 6. Canonical JSON is content-determined, not insert-order-determined
-- ---------------------------------------------------------------------------
insert into public.entries (id, project_id, entry_date, author_id)
values ('cccccccc-0000-0000-0000-000000000004', 'bbbbbbbb-0000-0000-0000-000000000001',
        date '2026-08-20', '22222222-2222-2222-2222-222222222222');

-- Same two labour rows as entry 1, inserted in the opposite order.
insert into public.labour (entry_id, person_name, role, hours, source_quote, confidence)
values
  ('cccccccc-0000-0000-0000-000000000004', 'Sam Whitely', 'labourer',     8.50,
   'Danny and Sam on the pier all day', 'high'),
  ('cccccccc-0000-0000-0000-000000000004', 'Danny Rowe',  'leading hand', 9.00,
   'Danny and Sam on the pier all day', 'high');

do $$
declare a jsonb; b jsonb;
begin
  select app.canonical_entry_json(e) -> 'labour' into a
    from public.entries e where e.id = 'cccccccc-0000-0000-0000-000000000001';
  select app.canonical_entry_json(e) -> 'labour' into b
    from public.entries e where e.id = 'cccccccc-0000-0000-0000-000000000004';
  assert a::text = b::text,
    format('canonical labour array is order-dependent:%s%s%s%s', chr(10), a, chr(10), b);
  raise notice 'PASS  canonical JSON is insert-order independent';
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Corrections supersede; they never edit
-- ---------------------------------------------------------------------------
select tests.expect_error($q$
  insert into public.entries (project_id, entry_date, author_id, supersedes_entry_id)
  values ('bbbbbbbb-0000-0000-0000-000000000001', date '2026-08-24',
          '11111111-1111-1111-1111-111111111111',
          'cccccccc-0000-0000-0000-000000000002')
$q$, 'only a signed entry can be superseded');

select tests.expect_error($q$
  insert into public.entries (project_id, entry_date, author_id, supersedes_entry_id)
  values ('bbbbbbbb-0000-0000-0000-000000000002', date '2026-08-24',
          '44444444-4444-4444-4444-444444444444',
          'cccccccc-0000-0000-0000-000000000001')
$q$, 'same project');

-- A correction on the same date by the same author is allowed.
insert into public.entries (id, project_id, entry_date, author_id, supersedes_entry_id)
values ('cccccccc-0000-0000-0000-000000000005', 'bbbbbbbb-0000-0000-0000-000000000001',
        date '2026-08-24', '11111111-1111-1111-1111-111111111111',
        'cccccccc-0000-0000-0000-000000000001');

do $$
begin
  assert (select entry_no from public.entries
           where id = 'cccccccc-0000-0000-0000-000000000005') is null,
         'the correction was numbered while still a draft';
  raise notice 'PASS  corrections supersede, and are unnumbered until signed';
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Serials are gap-free, and follow signing order rather than entry_date
--
-- By this point the project has seen: entry 1 signed, entry 3 created and
-- deleted, entries 2, 4 and 5 still drafts. Only one number has been issued.
-- Sign the correction (dated the 24th) before the older draft (dated the 25th)
-- to show that the run follows the order entries are signed.
-- ---------------------------------------------------------------------------
update public.entries set status = 'signed'
 where id = 'cccccccc-0000-0000-0000-000000000005';   -- correction, 2026-08-24

update public.entries set status = 'signed'
 where id = 'cccccccc-0000-0000-0000-000000000002';   -- older draft, 2026-08-25

do $$
declare
  v_seqs integer[];
begin
  select array_agg(entry_seq order by entry_seq)
    into v_seqs
    from public.entries
   where project_id = 'bbbbbbbb-0000-0000-0000-000000000001'
     and status = 'signed';

  assert v_seqs = array[1, 2, 3],
         format('signed serials are %s, expected a gap-free 1,2,3', v_seqs);

  assert (select entry_no from public.entries where id = 'cccccccc-0000-0000-0000-000000000005')
         = 'KBS-2026-08-24-2',
         'a same-day correction should take the date reference with a suffix';
  -- The other project under the same org already signed an entry dated the
  -- 25th, so this one collides on the org-date base and takes the suffix.
  assert (select entry_no from public.entries where id = 'cccccccc-0000-0000-0000-000000000002')
         = 'KBS-2026-08-25-2', 'org-date collision should suffix, not fail';

  -- The deleted draft (entry 3 above) burned nothing.
  assert (select count(*) from public.entries
           where project_id = 'bbbbbbbb-0000-0000-0000-000000000001'
             and status = 'signed') = 3, 'unexpected signed count';

  raise notice 'PASS  serials are gap-free and follow signing order (1,2,3)';
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. RLS
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
set local role authenticated;  -- PM

do $$
begin
  assert (select count(*) from public.entries) > 0, 'PM cannot read project entries';
  assert (select count(*) from public.entries
           where project_id = 'bbbbbbbb-0000-0000-0000-000000000002') = 0,
         'PM can see another project''s entries';
  raise notice 'PASS  PM reads own project only';
end;
$$;

select tests.expect_error($q$
  insert into public.entries (project_id, entry_date, author_id)
  values ('bbbbbbbb-0000-0000-0000-000000000001', date '2026-08-26',
          '33333333-3333-3333-3333-333333333333')
$q$, 'row-level security');

reset role;
select set_config('request.jwt.claims', '', true);

select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;  -- supervisor

-- Cannot author an entry in someone else's name.
select tests.expect_error($q$
  insert into public.entries (project_id, entry_date, author_id)
  values ('bbbbbbbb-0000-0000-0000-000000000001', date '2026-08-26',
          '22222222-2222-2222-2222-222222222222')
$q$, 'row-level security');

-- Cannot author into a project they are not a member of.
select tests.expect_error($q$
  insert into public.entries (project_id, entry_date, author_id)
  values ('bbbbbbbb-0000-0000-0000-000000000002', date '2026-08-26',
          '11111111-1111-1111-1111-111111111111')
$q$, 'row-level security');

-- Cannot touch another supervisor's draft.
select tests.expect_error($q$
  insert into public.labour (entry_id, person_name, hours)
  values ('cccccccc-0000-0000-0000-000000000004', 'Nobody', 8)
$q$, 'row-level security');

do $$
begin
  assert (select count(*) from public.entries) = 4,
         format('supervisor sees %s entries, expected 4 in their project',
                (select count(*) from public.entries));
  raise notice 'PASS  supervisor write scope is own drafts in own projects';
end;
$$;

reset role;
select set_config('request.jwt.claims', '', true);

select set_config('request.jwt.claims',
  '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
set local role authenticated;  -- member of the other project only

do $$
begin
  assert (select count(*) from public.entries
           where project_id = 'bbbbbbbb-0000-0000-0000-000000000001') = 0,
         'outsider can read another project''s entries';
  assert (select count(*) from public.labour) = 0,
         'outsider can read another project''s labour rows';
  assert (select count(*) from public.projects) = 1,
         'outsider can see projects they are not a member of';
  raise notice 'PASS  non-members see nothing';
end;
$$;

reset role;
select set_config('request.jwt.claims', '', true);

-- ---------------------------------------------------------------------------
-- The database owns the signature. A client cannot supply it.
--
-- entries_update_own_draft lets an author move their own draft to 'signed',
-- and its WITH CHECK constrains only author_id. Without this guard a
-- supervisor could back-date signed_at and attribute signed_by to someone
-- else, and the content hash would not show it because it excludes the
-- signature block.
-- ---------------------------------------------------------------------------
insert into public.entries (id, project_id, entry_date, author_id)
values ('cccccccc-0000-0000-0000-0000000000f1', 'bbbbbbbb-0000-0000-0000-000000000001',
        date '2026-08-19', '22222222-2222-2222-2222-222222222222');

select tests.expect_error($q$
  update public.entries
     set status    = 'signed',
         signed_at = timestamptz '2020-01-01 00:00:00+08',
         signed_by = '11111111-1111-1111-1111-111111111111'
   where id = 'cccccccc-0000-0000-0000-0000000000f1'
$q$, 'signature is issued by the database');

select tests.expect_error($q$
  update public.entries
     set status    = 'signed',
         signed_at = timestamptz '2020-01-01 00:00:00+08'
   where id = 'cccccccc-0000-0000-0000-0000000000f1'
$q$, 'signature is issued by the database');

do $$
begin
  assert (select status from public.entries
           where id = 'cccccccc-0000-0000-0000-0000000000f1') = 'draft',
         'entry moved to signed despite a refused signature';
  raise notice 'PASS  a client cannot supply signed_at or signed_by';
end;
$$;

do $$ begin raise notice ''; raise notice 'ALL TESTS PASSED'; end; $$;

rollback;
