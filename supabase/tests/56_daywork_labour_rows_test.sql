-- Hours per person on a daywork (README R129): the save keeps each person's hours and sums them into the daywork's
-- hours only when everyone has them; a person without hours is asked about, never given a share; the hash carries the
-- rows only where they exist, so a daywork recorded before the column verifies as it did.
begin;
insert into auth.users (id, email) values ('11111111-5656-0000-0000-000000000001', 'sup.dwl@example.com');
insert into public.organisations (id, name, code) values ('aaaaaaaa-5656-0000-0000-000000000001', 'Daywork Civil', 'DWC');
insert into public.projects (id, org_id, name, code) values ('bbbbbbbb-5656-0000-0000-000000000001', 'aaaaaaaa-5656-0000-0000-000000000001', 'Daywork Job', 'F561');
insert into public.project_members (project_id, user_id, role) values ('bbbbbbbb-5656-0000-0000-000000000001', '11111111-5656-0000-0000-000000000001', 'supervisor');
insert into public.entries (id, project_id, entry_date, author_id) values ('cccccccc-5656-0000-0000-000000000001', 'bbbbbbbb-5656-0000-0000-000000000001', '2026-10-01', '11111111-5656-0000-0000-000000000001');
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-5656-0000-0000-000000000001","role":"authenticated"}';

select public.apply_entry_review('cccccccc-5656-0000-0000-000000000001', jsonb_build_object(
  'dayworks', jsonb_build_array(
    -- Everyone has hours: the total is theirs, not the 99 typed.
    jsonb_build_object('description', 'Moving light poles', 'hours', 99, 'labour', 'Matt and Evan',
                       'labour_rows', jsonb_build_array(jsonb_build_object('person_name', ' Matthew  Rodgers ', 'hours', 6.5), jsonb_build_object('person_name', 'Evan Burke', 'hours', 6.5))),
    -- One without: the total stays as typed; the person is asked about.
    jsonb_build_object('description', 'Concrete cutting', 'hours', 4, 'labour_rows', jsonb_build_array(jsonb_build_object('person_name', 'Evan Burke', 'hours', 4), jsonb_build_object('person_name', 'Matthew Rodgers', 'hours', null))),
    -- No people listed: as before.
    jsonb_build_object('description', 'Vac truck and driver', 'hours', null, 'labour', 'Souf'),
    -- A blank name is dropped; an empty list is null.
    jsonb_build_object('description', 'Blank names', 'hours', 2, 'labour_rows', jsonb_build_array(jsonb_build_object('person_name', '  ', 'hours', 1)))
  )));
do $$
declare r record;
begin
  select hours, labour_rows into r from public.dayworks where entry_id = 'cccccccc-5656-0000-0000-000000000001' and description = 'Moving light poles';
  if r.hours <> 13 then raise exception 'TESTFAIL: hours should be the people''s sum, got %', r.hours; end if;
  if (r.labour_rows->0->>'person_name') <> 'Matthew Rodgers' then raise exception 'TESTFAIL: name not tidied'; end if;
  select hours, labour_rows into r from public.dayworks where entry_id = 'cccccccc-5656-0000-0000-000000000001' and description = 'Concrete cutting';
  if r.hours <> 4 then raise exception 'TESTFAIL: a person without hours must not change the typed total, got %', r.hours; end if;
  if (r.labour_rows->1->>'hours') is not null then raise exception 'TESTFAIL: a missing figure must stay missing'; end if;
  select hours, labour_rows into r from public.dayworks where entry_id = 'cccccccc-5656-0000-0000-000000000001' and description = 'Vac truck and driver';
  if r.hours is not null or r.labour_rows is not null then raise exception 'TESTFAIL: a daywork with no people is as before'; end if;
  select labour_rows into r from public.dayworks where entry_id = 'cccccccc-5656-0000-0000-000000000001' and description = 'Blank names';
  if jsonb_array_length(r.labour_rows) <> 0 then raise exception 'TESTFAIL: blank names should be dropped'; end if;
  if not ('daywork_labour_missing_hours' = any (app.entry_warnings('cccccccc-5656-0000-0000-000000000001'))) then raise exception 'TESTFAIL: the missing hours should be asked about'; end if;
end; $$;

-- The hash: labour_rows present where recorded, absent where not — so older dayworks read as they always did.
do $$
declare j jsonb; dw jsonb;
begin
  select app.canonical_entry_json(e) into j from public.entries e where e.id = 'cccccccc-5656-0000-0000-000000000001';
  select value into dw from jsonb_array_elements(j->'dayworks') where value->>'description' = 'Moving light poles';
  if not (dw ? 'labour_rows') then raise exception 'TESTFAIL: recorded people should be in the hash'; end if;
  select value into dw from jsonb_array_elements(j->'dayworks') where value->>'description' = 'Vac truck and driver';
  if dw ? 'labour_rows' then raise exception 'TESTFAIL: a daywork without people must not carry the key'; end if;
end; $$;
rollback;
