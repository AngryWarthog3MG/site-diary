-- ============================================================================
-- supabase/tests/05_review_test.sql
--
-- Covers the review and signing path:
--   * applying a reviewed entry replaces the child rows atomically
--   * an item the supervisor added by hand carries no source_quote
--   * blocking gaps and warnings come back through one client-visible call
--   * a bad payload takes nothing with it — the draft is left intact
--   * signing is refused while gaps remain, and succeeds once they clear
--   * the projected hash is what the entry actually signs with
--   * a PM cannot apply, and a non-member cannot even look
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
  ('11111111-1111-1111-1111-111111111111', 'sup@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'pm@example.com'),
  ('44444444-4444-4444-4444-444444444444', 'outsider@example.com');

insert into public.organisations (id, name, code)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'Kingsbridge Civil', 'KBS');

insert into public.projects (id, org_id, name, code) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Northern', 'C001'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'Other', 'C002');

insert into public.project_members (project_id, user_id, role) values
  ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'supervisor'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'pm'),
  ('bbbbbbbb-0000-0000-0000-000000000002', '44444444-4444-4444-4444-444444444444', 'supervisor');

insert into public.entries (id, project_id, entry_date, author_id, transcript_raw)
values ('cccccccc-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001',
        date '2026-08-25', '11111111-1111-1111-1111-111111111111',
        'Danny and Sam on the deck, nine hours each. Poured the headstock.');

select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;

-- ---------------------------------------------------------------------------
-- 1. Applying writes the record
-- ---------------------------------------------------------------------------
select public.apply_entry_review('cccccccc-0000-0000-0000-000000000001', $j$
{
  "labour": [
    {"person_name":"Danny Rowe","hours":9,"source_quote":"Danny and Sam on the deck","confidence":"high"},
    {"person_name":"Sam Whitely","hours":9,"source_quote":"Danny and Sam on the deck","confidence":"high"},
    {"person_name":"Kel Brady","hours":4}
  ],
  "pours": [
    {"location":"Pier 3 headstock","volume_m3":18.5,"docket_nos":["4471"],
     "source_quote":"Poured the headstock","confidence":"low"}
  ],
  "sections": [
    {"section":"labour","state":"captured"},
    {"section":"plant","state":"nil_confirmed","note":"Confirmed nothing on plant"},
    {"section":"work_items","state":"captured"},
    {"section":"variations","state":"nil_confirmed"},
    {"section":"delays","state":"nil_confirmed"},
    {"section":"weather","state":"gap"}
  ],
  "weather_impact": "Blowy but it did not stop us"
}
$j$::jsonb);

do $$
begin
  assert (select count(*) from public.labour
           where entry_id = 'cccccccc-0000-0000-0000-000000000001') = 3, 'labour not applied';
  assert (select hours from public.labour
           where entry_id = 'cccccccc-0000-0000-0000-000000000001'
             and person_name = 'Kel Brady') = 4, 'a hand-added worker was lost';
  -- Nothing in the transcript says it, so nothing should claim otherwise.
  assert (select source_quote from public.labour
           where entry_id = 'cccccccc-0000-0000-0000-000000000001'
             and person_name = 'Kel Brady') is null,
         'a hand-added item was given a source quote';
  assert (select state from public.entry_sections
           where entry_id = 'cccccccc-0000-0000-0000-000000000001'
             and section = 'plant')::text = 'nil_confirmed',
         'the confirmed nil was not recorded';
  assert (select observed_impact from public.weather
           where entry_id = 'cccccccc-0000-0000-0000-000000000001')
         = 'Blowy but it did not stop us', 'weather impact not applied';
  raise notice 'PASS  applying writes the record, including hand-added items';
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Gaps and warnings come back through one client-visible call
-- ---------------------------------------------------------------------------
do $$
declare v jsonb;
begin
  v := public.entry_review_state('cccccccc-0000-0000-0000-000000000001');
  assert v ->> 'status' = 'draft', 'status wrong';
  assert v -> 'blocking_gaps' = '[]'::jsonb,
         format('unexpected gaps: %s', v -> 'blocking_gaps');
  -- No hash before signing: entry_no is inside the hashed content and the
  -- serial does not exist yet, so any figure shown here would be wrong.
  assert v -> 'projected_hash' is null, 'a pre-signature hash was exposed';
  assert v ->> 'content_hash' is null, 'a draft reported a content hash';
  raise notice 'PASS  review state is visible, and shows no hash before there is one';
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Re-applying replaces rather than accumulates
-- ---------------------------------------------------------------------------
select public.apply_entry_review('cccccccc-0000-0000-0000-000000000001', $j$
{
  "labour": [{"person_name":"Danny Rowe","hours":9}],
  "variations": [{"description":"Extra rock breaking"}],
  "delays": [{"cause":"Rain","start_time":"09:30","category":"weather"}],
  "pours": [{"location":"Pier 3 headstock"}],
  "sections": [{"section":"labour","state":"captured"}]
}
$j$::jsonb);

do $$
begin
  assert (select count(*) from public.labour
           where entry_id = 'cccccccc-0000-0000-0000-000000000001') = 1,
         're-applying accumulated instead of replacing';
  assert (select count(*) from public.entry_sections
           where entry_id = 'cccccccc-0000-0000-0000-000000000001') = 1,
         'section states accumulated';
  assert (select observed_impact from public.weather
           where entry_id = 'cccccccc-0000-0000-0000-000000000001') is null,
         'a removed weather impact survived';
  raise notice 'PASS  re-applying replaces the entry rather than adding to it';
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Signing is refused while gaps remain
-- ---------------------------------------------------------------------------
do $$
declare gaps jsonb;
begin
  gaps := public.entry_review_state('cccccccc-0000-0000-0000-000000000001') -> 'blocking_gaps';
  assert gaps @> '["variation_missing_number"]'::jsonb, format('missing number gap: %s', gaps);
  -- Owner decision 2026-08-27: a missing photo is no longer a gap.
  assert not gaps @> '["variation_missing_photo"]'::jsonb,
         format('the photo gap should be gone, got %s', gaps);
  assert gaps @> '["pour_missing_volume_m3"]'::jsonb, format('missing volume gap: %s', gaps);
  assert gaps @> '["delay_missing_times"]'::jsonb, format('missing delay gap: %s', gaps);
end;
$$;

select tests.expect_error($q$
  update public.entries set status = 'signed'
   where id = 'cccccccc-0000-0000-0000-000000000001'
$q$, 'blocking gaps remain');

do $$ begin raise notice 'PASS  signing is refused while gaps remain'; end; $$;

-- ---------------------------------------------------------------------------
-- 5. A bad payload takes nothing with it
-- ---------------------------------------------------------------------------
select tests.expect_error($q$
  select public.apply_entry_review('cccccccc-0000-0000-0000-000000000001', $j$
    {"labour":[{"person_name":"Danny Rowe","hours":9}],
     "delays":[{"cause":"Rain","category":"volcano"}]}
  $j$::jsonb)
$q$, 'delay_category');

do $$
begin
  assert (select count(*) from public.labour
           where entry_id = 'cccccccc-0000-0000-0000-000000000001') = 1,
         'a failed apply wiped the draft';
  assert (select count(*) from public.variations
           where entry_id = 'cccccccc-0000-0000-0000-000000000001') = 1,
         'a failed apply left the entry half-written';
  raise notice 'PASS  a rejected payload leaves the draft exactly as it was';
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Clearing the gaps and signing
-- ---------------------------------------------------------------------------
select public.apply_entry_review('cccccccc-0000-0000-0000-000000000001', $j$
{
  "labour": [{"person_name":"Danny Rowe","hours":9}],
  "variations": [{"description":"Extra rock breaking","register_seq":14,"hours":3.5}],
  "delays": [{"cause":"Rain","start_time":"09:30","end_time":"11:15","category":"weather"}],
  "pours": [{"location":"Pier 3 headstock","volume_m3":18.5}],
  "sections": [{"section":"labour","state":"captured"}]
}
$j$::jsonb);

do $$
declare v jsonb;
begin
  assert public.entry_review_state('cccccccc-0000-0000-0000-000000000001') -> 'blocking_gaps'
         = '[]'::jsonb, 'gaps did not clear';
  assert (select hours from public.variations where entry_id = 'cccccccc-0000-0000-0000-000000000001') = 3.5,
         'the hours stated on the day were not stored';
  assert app.canonical_entry_json((select e from public.entries e where e.id = 'cccccccc-0000-0000-0000-000000000001'))
           -> 'variations' -> 0 ? 'hours',
         'stated hours are part of the signed record';

  update public.entries set status = 'signed'
   where id = 'cccccccc-0000-0000-0000-000000000001';

  v := public.entry_review_state('cccccccc-0000-0000-0000-000000000001');

  assert v ->> 'entry_no' = 'KBS-2026-08-25', 'no reference issued on signing';
  assert (v ->> 'content_hash') ~ '^[0-9a-f]{64}$', 'no content hash after signing';
  assert app.verify_entry_hash('cccccccc-0000-0000-0000-000000000001'),
         'the stored hash does not verify against the signed record';
  raise notice 'PASS  signing issues the serial and a hash that verifies (%)',
               left(v ->> 'content_hash', 12);
end;
$$;

-- A weather delay on a day with no rainfall recorded is a question, not a veto.
do $$
declare v jsonb;
begin
  v := public.entry_review_state('cccccccc-0000-0000-0000-000000000001');
  assert v -> 'warnings' @> '["weather_delay_without_weather_record"]'::jsonb,
         format('expected the weather warning, got %s', v -> 'warnings');
  assert v ->> 'status' = 'signed', 'the warning blocked signing';
  raise notice 'PASS  a warning travels with the signed entry without blocking it';
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. A signed entry can no longer be re-applied
-- ---------------------------------------------------------------------------
select tests.expect_error($q$
  select public.apply_entry_review('cccccccc-0000-0000-0000-000000000001', '{}'::jsonb)
$q$, 'not an open draft');

do $$ begin raise notice 'PASS  a signed entry cannot be re-applied'; end; $$;

reset role;
select set_config('request.jwt.claims', '', true);

-- ---------------------------------------------------------------------------
-- 8. Who may do what
-- ---------------------------------------------------------------------------
insert into public.entries (id, project_id, entry_date, author_id)
values ('cccccccc-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000001',
        date '2026-08-26', '11111111-1111-1111-1111-111111111111');

select set_config('request.jwt.claims',
  '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
set local role authenticated;

do $$
begin
  -- A PM reads the record, including its gaps. They do not write it.
  assert public.entry_review_state('cccccccc-0000-0000-0000-000000000002') is not null,
         'a PM cannot read the review state';
end;
$$;

select tests.expect_error($q$
  select public.apply_entry_review('cccccccc-0000-0000-0000-000000000002',
    '{"labour":[{"person_name":"Ghost"}]}'::jsonb)
$q$, 'not an open draft');

reset role;
select set_config('request.jwt.claims', '', true);

select set_config('request.jwt.claims',
  '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
set local role authenticated;

do $$
begin
  assert public.entry_review_state('cccccccc-0000-0000-0000-000000000002') is null,
         'a non-member can read another project''s review state';
  raise notice 'PASS  PMs read but never apply; non-members see nothing';
end;
$$;

reset role;
select set_config('request.jwt.claims', '', true);

-- ---------------------------------------------------------------------------
-- 9. Shared drafts: a colleague with an authoring role may finish and sign a
--    day someone else started, and the signature names the signer.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('55555555-5555-5555-5555-555555555555', 'sup2@example.com');
insert into public.project_members (project_id, user_id, role) values
  ('bbbbbbbb-0000-0000-0000-000000000001', '55555555-5555-5555-5555-555555555555', 'supervisor');
insert into public.entries (id, project_id, entry_date, author_id, transcript_raw)
values ('cccccccc-0000-0000-0000-000000000009', 'bbbbbbbb-0000-0000-0000-000000000001',
        date '2026-08-27', '55555555-5555-5555-5555-555555555555',
        'Sam on the deck all day.');

select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;  -- the other supervisor, not the author

select public.apply_entry_review('cccccccc-0000-0000-0000-000000000009', $j$
{
  "labour": [{"person_name":"Sam Whitely","hours":8}],
  "sections": [{"section":"labour","state":"captured"}]
}
$j$::jsonb);

update public.entries set status = 'signed'
 where id = 'cccccccc-0000-0000-0000-000000000009';

do $$
declare r public.entries;
begin
  select * into r from public.entries where id = 'cccccccc-0000-0000-0000-000000000009';
  assert r.status = 'signed', 'a colleague could not sign the shared draft';
  assert r.author_id = '55555555-5555-5555-5555-555555555555', 'author_id changed on signing';
  assert r.signed_by = '11111111-1111-1111-1111-111111111111',
         format('signed_by names %s, expected the signer', r.signed_by);
  raise notice 'PASS  a colleague finishes and signs a shared draft; the signature names the signer';
end;
$$;

reset role;
select set_config('request.jwt.claims', '', true);

-- The PM still cannot: the same shape on the pm's session touches nothing.
select set_config('request.jwt.claims',
  '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
set local role authenticated;
select tests.expect_error($q$
  select public.apply_entry_review('cccccccc-0000-0000-0000-000000000001', '{}'::jsonb)
$q$, 'not an open draft');
reset role;
select set_config('request.jwt.claims', '', true);

-- ---------------------------------------------------------------------------
-- 10. sign_entry applies the payload and signs in one call.
-- ---------------------------------------------------------------------------
insert into public.entries (id, project_id, entry_date, author_id, transcript_raw)
values ('cccccccc-0000-0000-0000-000000000010', 'bbbbbbbb-0000-0000-0000-000000000001',
        date '2026-08-28', '55555555-5555-5555-5555-555555555555', 'Danny on the deck.');
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;
do $$
declare v jsonb; r public.entries;
begin
  v := public.sign_entry('cccccccc-0000-0000-0000-000000000010', $j$
    {"labour":[{"person_name":"Danny Rowe","hours":8}],"sections":[{"section":"labour","state":"captured"}]}
  $j$::jsonb);
  select * into r from public.entries where id = 'cccccccc-0000-0000-0000-000000000010';
  assert r.status = 'signed', 'sign_entry did not sign';
  assert r.signed_by = '11111111-1111-1111-1111-111111111111', 'sign_entry attributed the signature wrongly';
  assert (select count(*) from public.labour where entry_id = r.id) = 1, 'sign_entry did not apply the payload';
  assert v ->> 'status' = 'signed', 'sign_entry returned a stale state';
  raise notice 'PASS  sign_entry applies and signs in one transaction, naming the signer';
end;
$$;
select tests.expect_error($q$
  select public.sign_entry('cccccccc-0000-0000-0000-000000000010', '{}'::jsonb)
$q$, 'not an open draft');
reset role;
select set_config('request.jwt.claims', '', true);

do $$ begin raise notice ''; raise notice 'ALL REVIEW TESTS PASSED'; end; $$;

rollback;
