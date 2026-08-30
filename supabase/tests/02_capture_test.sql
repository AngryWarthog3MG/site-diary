-- ============================================================================
-- supabase/tests/02_capture_test.sql
--
-- Covers step 2's database surface:
--   * audio segments are ordered, and re-upload of the same client_ref is a
--     no-op rather than a duplicate
--   * entries.audio_url and entries.transcript_raw stay derived from segments
--   * segments of a signed entry are immutable, and the rollup cannot reach one
--   * the transcription boost list combines manual keywords with what the
--     diary already knows, and is empty for a non-member
--   * audio segments are inside the content hash
--
-- Runs in one transaction and rolls back.
-- ============================================================================

begin;

create schema tests;
grant usage on schema tests to public;

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

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'sup1@example.com'),
  ('44444444-4444-4444-4444-444444444444', 'outsider@example.com');

insert into public.organisations (id, name, code)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'Kingsbridge Civil', 'KBS');

insert into public.projects (id, org_id, name, code) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   'Northern Interchange', 'C001'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001',
   'Other Site', 'C002');

insert into public.project_members (project_id, user_id, role) values
  ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'supervisor'),
  ('bbbbbbbb-0000-0000-0000-000000000002', '44444444-4444-4444-4444-444444444444', 'supervisor');

insert into public.entries (id, project_id, entry_date, author_id)
values ('cccccccc-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001',
        date '2026-08-25', '11111111-1111-1111-1111-111111111111');

-- ---------------------------------------------------------------------------
-- 1. Segments are ordered, and the rollup keeps entries in step
-- ---------------------------------------------------------------------------
insert into public.entry_audio (entry_id, url, mime_type, duration_ms, client_ref)
values ('cccccccc-0000-0000-0000-000000000001',
        'bbbbbbbb-0000-0000-0000-000000000001/cccccccc-0000-0000-0000-000000000001/take-1.webm',
        'audio/webm;codecs=opus', 91000, 'local-1');

insert into public.entry_audio (entry_id, url, mime_type, duration_ms, client_ref)
values ('cccccccc-0000-0000-0000-000000000001',
        'bbbbbbbb-0000-0000-0000-000000000001/cccccccc-0000-0000-0000-000000000001/take-2.webm',
        'audio/webm;codecs=opus', 24000, 'local-2');

do $$
begin
  assert (select array_agg(seq order by seq) from public.entry_audio
           where entry_id = 'cccccccc-0000-0000-0000-000000000001') = array[1, 2],
         'segment seq not allocated 1,2';
  assert (select audio_url from public.entries
           where id = 'cccccccc-0000-0000-0000-000000000001')
         like '%take-1.webm', 'audio_url is not the first segment';
  assert (select transcript_raw from public.entries
           where id = 'cccccccc-0000-0000-0000-000000000001') is null,
         'transcript_raw set before any segment was transcribed';
  raise notice 'PASS  segments are ordered and roll up to the entry';
end;
$$;

-- Re-uploading the same local blob does not create a second segment.
select tests.expect_error($q$
  insert into public.entry_audio (entry_id, url, client_ref)
  values ('cccccccc-0000-0000-0000-000000000001',
          'bbbbbbbb-0000-0000-0000-000000000001/cccccccc-0000-0000-0000-000000000001/take-1.webm',
          'local-1')
$q$, 'entry_audio_entry_id_client_ref_key');

do $$ begin raise notice 'PASS  re-upload of the same client_ref is rejected'; end; $$;

-- ---------------------------------------------------------------------------
-- 2. Transcripts concatenate in segment order
-- ---------------------------------------------------------------------------
update public.entry_audio
   set transcript = 'Five blokes on the pier today.',
       transcript_status = 'done', transcript_provider = 'deepgram:nova-3',
       transcribed_at = now()
 where entry_id = 'cccccccc-0000-0000-0000-000000000001' and seq = 2;

update public.entry_audio
   set transcript = 'Danny and Sam on the deck.',
       transcript_status = 'done', transcript_provider = 'deepgram:nova-3',
       transcribed_at = now()
 where entry_id = 'cccccccc-0000-0000-0000-000000000001' and seq = 1;

do $$
begin
  assert (select transcript_raw from public.entries
           where id = 'cccccccc-0000-0000-0000-000000000001')
         = E'Danny and Sam on the deck.\n\nFive blokes on the pier today.',
         'transcript_raw did not concatenate in segment order';
  raise notice 'PASS  transcripts concatenate in segment order, not arrival order';
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Audio is inside the content hash
-- ---------------------------------------------------------------------------
do $$
declare
  h_before text;
  h_after  text;
begin
  select app.entry_content_hash(e) into h_before
    from public.entries e where e.id = 'cccccccc-0000-0000-0000-000000000001';

  update public.entry_audio set duration_ms = 25000
   where entry_id = 'cccccccc-0000-0000-0000-000000000001' and seq = 2;

  select app.entry_content_hash(e) into h_after
    from public.entries e where e.id = 'cccccccc-0000-0000-0000-000000000001';

  assert h_before <> h_after, 'changing a segment did not change the content hash';
  raise notice 'PASS  audio segments are inside the content hash';
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Segments of a signed entry are immutable
-- ---------------------------------------------------------------------------
update public.entries set status = 'signed'
 where id = 'cccccccc-0000-0000-0000-000000000001';

select tests.expect_error($q$
  insert into public.entry_audio (entry_id, url, client_ref)
  values ('cccccccc-0000-0000-0000-000000000001',
          'bbbbbbbb-0000-0000-0000-000000000001/cccccccc-0000-0000-0000-000000000001/take-3.webm',
          'local-3')
$q$, 'is signed and immutable');

select tests.expect_error($q$
  update public.entry_audio set transcript = 'rewritten'
   where entry_id = 'cccccccc-0000-0000-0000-000000000001' and seq = 1
$q$, 'is signed and immutable');

select tests.expect_error($q$
  delete from public.entry_audio
   where entry_id = 'cccccccc-0000-0000-0000-000000000001'
$q$, 'is signed and immutable');

do $$
begin
  assert app.verify_entry_hash('cccccccc-0000-0000-0000-000000000001'),
         'hash of the signed entry does not verify';
  raise notice 'PASS  audio of a signed entry is immutable, hash verifies';
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. The transcription boost list
-- ---------------------------------------------------------------------------
insert into public.entries (id, project_id, entry_date, author_id)
values ('cccccccc-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000001',
        date '2026-08-26', '11111111-1111-1111-1111-111111111111');

insert into public.labour (entry_id, person_name, hours)
values ('cccccccc-0000-0000-0000-000000000002', 'Danny Rowe', 9);

insert into public.plant (entry_id, item, supplier, hours)
values ('cccccccc-0000-0000-0000-000000000002', 'Kobelco 35', 'Coates', 6);

insert into public.work_items (entry_id, area, description)
values ('cccccccc-0000-0000-0000-000000000002', 'Area B North', 'Trimmed subgrade');

insert into public.project_keywords (project_id, term, category) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'Chainage 4200', 'area'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'Kel Brady', 'person');

select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;

do $$
declare terms text[];
begin
  terms := public.project_keyterms('bbbbbbbb-0000-0000-0000-000000000001');
  assert 'Danny Rowe'    = any(terms), 'crew name missing from boost list';
  assert 'Kobelco 35'    = any(terms), 'plant item missing from boost list';
  assert 'Coates'        = any(terms), 'supplier missing from boost list';
  assert 'Area B North'  = any(terms), 'area missing from boost list';
  assert 'Chainage 4200' = any(terms), 'manual keyword missing from boost list';
  assert 'Kel Brady'     = any(terms), 'manual crew name missing from boost list';
  assert terms = (select array_agg(t order by t) from unnest(terms) t),
         'boost list is not deterministically ordered';
  raise notice 'PASS  boost list combines manual keywords with what the diary knows (% terms)',
               array_length(terms, 1);
end;
$$;

reset role;
select set_config('request.jwt.claims', '', true);

select set_config('request.jwt.claims',
  '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
set local role authenticated;

do $$
begin
  assert public.project_keyterms('bbbbbbbb-0000-0000-0000-000000000001') = '{}',
         'a non-member can read another project''s vocabulary';
  assert (select count(*) from public.entry_audio) = 0,
         'a non-member can read another project''s audio segments';
  raise notice 'PASS  vocabulary and audio are invisible to non-members';
end;
$$;

reset role;
select set_config('request.jwt.claims', '', true);

do $$ begin raise notice ''; raise notice 'ALL CAPTURE TESTS PASSED'; end; $$;

rollback;
