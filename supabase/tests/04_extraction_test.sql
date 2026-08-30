-- ============================================================================
-- supabase/tests/04_extraction_test.sql
--
-- Covers the extraction migration:
--   * a proposal is not the record — extraction writes here, nothing else
--   * one pending proposal per entry; re-running supersedes rather than stacks
--   * proposals freeze when the entry is signed
--   * the proposal is NOT part of the content hash
--   * project members read them; outsiders do not
--
-- Runs in one transaction and rolls back.
-- ============================================================================

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
      raise exception 'TESTFAIL: wrong error for [%] — got "%", expected "%"',
        p_sql, sqlerrm, p_fragment;
    end if;
end;
$$;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'sup1@example.com'),
  ('44444444-4444-4444-4444-444444444444', 'outsider@example.com');

insert into public.organisations (id, name, code)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'Kingsbridge Civil', 'KBS');

insert into public.projects (id, org_id, name, code) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Northern', 'C001'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'Other', 'C002');

insert into public.project_members (project_id, user_id, role) values
  ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'supervisor'),
  ('bbbbbbbb-0000-0000-0000-000000000002', '44444444-4444-4444-4444-444444444444', 'supervisor');

insert into public.entries (id, project_id, entry_date, author_id, transcript_raw)
values ('cccccccc-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001',
        date '2026-08-25', '11111111-1111-1111-1111-111111111111',
        'Danny and Sam on the deck at Pier 3, nine hours each.');

-- ---------------------------------------------------------------------------
-- 1. A proposal is not the record
-- ---------------------------------------------------------------------------
insert into public.entry_extractions
  (id, entry_id, model, prompt_version, transcript_sha256, proposal)
values (
  'eeeeeeee-0000-0000-0000-000000000001',
  'cccccccc-0000-0000-0000-000000000001',
  'claude-sonnet-4-6', 'extract-v1',
  repeat('a', 64),
  '{"labour":[{"person_name":"Danny Rowe","hours":9}],"sections":{}}'::jsonb
);

do $$
begin
  assert (select count(*) from public.labour
           where entry_id = 'cccccccc-0000-0000-0000-000000000001') = 0,
         'extraction leaked into the record';
  raise notice 'PASS  a proposal writes nothing to the record';
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. One pending proposal at a time
-- ---------------------------------------------------------------------------
select tests.expect_error($q$
  insert into public.entry_extractions
    (entry_id, model, prompt_version, transcript_sha256, proposal)
  values ('cccccccc-0000-0000-0000-000000000001', 'claude-sonnet-4-6', 'extract-v1',
          repeat('b', 64), '{}'::jsonb)
$q$, 'entry_extractions_one_pending');

-- Superseding the old one clears the way.
update public.entry_extractions set status = 'superseded'
 where id = 'eeeeeeee-0000-0000-0000-000000000001';

insert into public.entry_extractions
  (id, entry_id, model, prompt_version, transcript_sha256, proposal)
values ('eeeeeeee-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-000000000001',
        'claude-sonnet-4-6', 'extract-v2', repeat('b', 64), '{"labour":[]}'::jsonb);

do $$
begin
  assert (select count(*) from public.entry_extractions
           where entry_id = 'cccccccc-0000-0000-0000-000000000001') = 2,
         'the superseded proposal was lost';
  assert (select count(*) from public.entry_extractions
           where entry_id = 'cccccccc-0000-0000-0000-000000000001'
             and status = 'pending') = 1,
         'more than one proposal is pending';
  raise notice 'PASS  re-running supersedes rather than stacking, and keeps the old one';
end;
$$;

-- An applied proposal has to say who applied it and when.
select tests.expect_error($q$
  update public.entry_extractions set status = 'applied'
   where id = 'eeeeeeee-0000-0000-0000-000000000002'
$q$, 'entry_extractions_applied_complete');

do $$ begin raise notice 'PASS  applying a proposal records who and when'; end; $$;

-- ---------------------------------------------------------------------------
-- 3. The proposal is retained history, not part of the hash
-- ---------------------------------------------------------------------------
do $$
declare h_before text; h_after text;
begin
  select app.entry_content_hash(e) into h_before
    from public.entries e where e.id = 'cccccccc-0000-0000-0000-000000000001';

  update public.entry_extractions
     set proposal = '{"labour":[{"person_name":"Somebody Else"}]}'::jsonb
   where id = 'eeeeeeee-0000-0000-0000-000000000002';

  select app.entry_content_hash(e) into h_after
    from public.entries e where e.id = 'cccccccc-0000-0000-0000-000000000001';

  assert h_before = h_after,
         'the hash covers the proposal — it should cover what was signed, not what was suggested';
  raise notice 'PASS  the hash covers the record, not the suggestion';
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Proposals freeze with the entry
-- ---------------------------------------------------------------------------
update public.entries set status = 'signed'
 where id = 'cccccccc-0000-0000-0000-000000000001';

select tests.expect_error($q$
  update public.entry_extractions set status = 'discarded'
   where id = 'eeeeeeee-0000-0000-0000-000000000002'
$q$, 'is signed and immutable');

select tests.expect_error($q$
  delete from public.entry_extractions
   where id = 'eeeeeeee-0000-0000-0000-000000000001'
$q$, 'is signed and immutable');

select tests.expect_error($q$
  insert into public.entry_extractions
    (entry_id, model, prompt_version, transcript_sha256, proposal)
  values ('cccccccc-0000-0000-0000-000000000001', 'claude-sonnet-4-6', 'extract-v3',
          repeat('c', 64), '{}'::jsonb)
$q$, 'is signed and immutable');

do $$ begin raise notice 'PASS  what the model proposed is frozen alongside what was signed'; end; $$;

-- ---------------------------------------------------------------------------
-- 5. RLS
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;

do $$
begin
  assert (select count(*) from public.entry_extractions) = 2,
         'the author cannot read their own proposals';
end;
$$;

reset role;
select set_config('request.jwt.claims', '', true);

select set_config('request.jwt.claims',
  '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
set local role authenticated;

do $$
begin
  assert (select count(*) from public.entry_extractions) = 0,
         'an outsider can read another project''s proposals';
  raise notice 'PASS  proposals are scoped by project membership';
end;
$$;

reset role;
select set_config('request.jwt.claims', '', true);

do $$ begin raise notice ''; raise notice 'ALL EXTRACTION TESTS PASSED'; end; $$;

rollback;
