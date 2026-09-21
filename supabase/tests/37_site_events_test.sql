-- Site events are a section of the day: rewritten on every save, frozen at signing, part of the hash only when
-- present. Notices are the office's: a supervisor reads none, a PM drafts one from a SIGNED event only, and once
-- sent it is frozen but for voiding.
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

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-5555-0000-0000-000000000001', 'sup.events@example.com', '{"full_name":"Sup Events"}'),
  ('11111111-5555-0000-0000-000000000002', 'pm.events@example.com', '{"full_name":"Pam Office"}');
insert into public.organisations (id, name, code) values ('aaaaaaaa-5555-0000-0000-000000000001', 'Events Civil', 'EVC');
insert into public.projects (id, org_id, name, code) values ('bbbbbbbb-5555-0000-0000-000000000001', 'aaaaaaaa-5555-0000-0000-000000000001', 'Events Job', 'E001');
insert into public.project_members (project_id, user_id, role) values
  ('bbbbbbbb-5555-0000-0000-000000000001', '11111111-5555-0000-0000-000000000001', 'supervisor'),
  ('bbbbbbbb-5555-0000-0000-000000000001', '11111111-5555-0000-0000-000000000002', 'pm');

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-5555-0000-0000-000000000001","role":"authenticated"}';

insert into public.entries (id, project_id, entry_date, author_id)
values ('cccccccc-5555-0000-0000-000000000001', 'bbbbbbbb-5555-0000-0000-000000000001', '2026-09-18', '11111111-5555-0000-0000-000000000001');

-- An entry with no events hashes exactly as it always did: no key at all.
do $$
declare j jsonb;
begin
  select app.canonical_entry_json(e) into j from public.entries e where e.id = 'cccccccc-5555-0000-0000-000000000001';
  if j ? 'site_events' then raise exception 'TESTFAIL: an entry with no events must not carry the key — every earlier signed hash depends on it'; end if;
end; $$;

-- The review screen saves the day: the event lands in the supervisor's words, and a blank one is nobody's.
select public.apply_entry_review('cccccccc-5555-0000-0000-000000000001', jsonb_build_object(
  'site_events', jsonb_build_array(
    jsonb_build_object('said_text', 'Lendlease told us to hold the west kerb till the pegs are re-set, so the boys moved onto the drainage',
                       'location', 'Chainage 4200', 'directed_by', 'Dave Keane', 'occurred_time', '10:15', 'photo_urls', '{}'::text[]),
    jsonb_build_object('said_text', '   ')
  ),
  'sections', jsonb_build_array(jsonb_build_object('section', 'site_events', 'state', 'captured'))
));
do $$
declare n integer; j jsonb; w text;
begin
  select count(*) into n from public.site_events where entry_id = 'cccccccc-5555-0000-0000-000000000001';
  if n <> 1 then raise exception 'TESTFAIL: expected the one event with words, got %', n; end if;
  select said_text into w from public.site_events where entry_id = 'cccccccc-5555-0000-0000-000000000001';
  if w <> 'Lendlease told us to hold the west kerb till the pegs are re-set, so the boys moved onto the drainage' then raise exception 'TESTFAIL: the words changed: %', w; end if;
  select app.canonical_entry_json(e) into j from public.entries e where e.id = 'cccccccc-5555-0000-0000-000000000001';
  if not (j ? 'site_events') then raise exception 'TESTFAIL: an entry with an event must carry it in the hash'; end if;
  if jsonb_array_length(j -> 'site_events') <> 1 then raise exception 'TESTFAIL: hash carries % events', jsonb_array_length(j -> 'site_events'); end if;
end; $$;

-- Saving again rewrites the section: the supervisor corrected a word before signing.
select public.apply_entry_review('cccccccc-5555-0000-0000-000000000001', jsonb_build_object(
  'site_events', jsonb_build_array(jsonb_build_object('said_text', 'Lendlease told us to hold the west kerb till the survey pegs are re-set', 'occurred_time', '10:15')),
  'sections', jsonb_build_array(jsonb_build_object('section', 'site_events', 'state', 'captured'))
));
do $$
declare w text;
begin
  select said_text into w from public.site_events where entry_id = 'cccccccc-5555-0000-0000-000000000001';
  if w not like '%survey pegs%' then raise exception 'TESTFAIL: a draft save should replace the section, got %', w; end if;
end; $$;

-- The office cannot draft a notice from an event on a day that is not signed.
set local request.jwt.claims = '{"sub":"11111111-5555-0000-0000-000000000002","role":"authenticated"}';
select tests.expect_error($$
  insert into public.notices (project_id, site_event_id, what_happened)
  select 'bbbbbbbb-5555-0000-0000-000000000001', id, 'x' from public.site_events where entry_id = 'cccccccc-5555-0000-0000-000000000001'
$$, 'signed day');

-- The day is signed. Status alone: the database issues the signature, the serial and the hash itself.
reset role;
update public.entries set status = 'signed' where id = 'cccccccc-5555-0000-0000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-5555-0000-0000-000000000001","role":"authenticated"}';

-- Frozen with the day.
do $$
declare n integer;
begin
  update public.site_events set said_text = 'changed' where entry_id = 'cccccccc-5555-0000-0000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'TESTFAIL: a signed day''s event was changed'; end if;
end; $$;
reset role;
select tests.expect_error($$
  update public.site_events set said_text = 'changed' where entry_id = 'cccccccc-5555-0000-0000-000000000001'
$$, 'signed');
set local role authenticated;

-- A supervisor reads no notices, and cannot raise one.
set local request.jwt.claims = '{"sub":"11111111-5555-0000-0000-000000000001","role":"authenticated"}';
select tests.expect_error($$
  insert into public.notices (project_id, what_happened) values ('bbbbbbbb-5555-0000-0000-000000000001', 'x')
$$, 'row-level security');

-- The PM drafts one from the signed event, numbered; edits it; records it sent; then it is frozen but for voiding.
set local request.jwt.claims = '{"sub":"11111111-5555-0000-0000-000000000002","role":"authenticated"}';
insert into public.notices (id, project_id, site_event_id, what_happened)
select 'dddddddd-5555-0000-0000-000000000001', 'bbbbbbbb-5555-0000-0000-000000000001', id, 'Lendlease told us to hold the west kerb'
  from public.site_events where entry_id = 'cccccccc-5555-0000-0000-000000000001';
do $$
declare r public.notices;
begin
  select * into r from public.notices where id = 'dddddddd-5555-0000-0000-000000000001';
  if r.seq <> 1 then raise exception 'TESTFAIL: first notice should be 1, got %', r.seq; end if;
  if r.created_by <> '11111111-5555-0000-0000-000000000002' then raise exception 'TESTFAIL: created_by not stamped'; end if;
end; $$;
update public.notices set why_outside_scope = 'Survey is the head contractor''s under cl. 4.2' where id = 'dddddddd-5555-0000-0000-000000000001';
-- Sent needs a how.
select tests.expect_error($$
  update public.notices set sent_at = now() where id = 'dddddddd-5555-0000-0000-000000000001'
$$, 'notices_sent_needs_how');
update public.notices set sent_at = now(), sent_how = 'email', sent_to = 'Dave Keane' where id = 'dddddddd-5555-0000-0000-000000000001';
select tests.expect_error($$
  update public.notices set what_we_need = 'more' where id = 'dddddddd-5555-0000-0000-000000000001'
$$, 'void it and raise a new one');
update public.notices set voided_at = now(), void_reason = 'Sent to the wrong person' where id = 'dddddddd-5555-0000-0000-000000000001';
select tests.expect_error($$
  update public.notices set void_reason = 'x' where id = 'dddddddd-5555-0000-0000-000000000001'
$$, 'not changed');

-- The supervisor still sees nothing of it.
set local request.jwt.claims = '{"sub":"11111111-5555-0000-0000-000000000001","role":"authenticated"}';
do $$
declare n integer;
begin
  select count(*) into n from public.notices; if n <> 0 then raise exception 'TESTFAIL: a supervisor read % notice(s)', n; end if;
  select count(*) into n from public.site_event_triage; if n <> 0 then raise exception 'TESTFAIL: a supervisor read triage'; end if;
end; $$;

rollback;
