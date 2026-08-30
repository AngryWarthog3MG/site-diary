-- ============================================================================
-- supabase/seed.sql — local development only.
-- Runs after migrations on `supabase db reset`. Never run against production.
--
-- Creates one organisation, one project, and three seats. Sign in at
-- http://localhost:3000 with any of these addresses; the magic-link mail
-- arrives in Inbucket at http://localhost:54324.
-- ============================================================================

insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'supervisor@example.com', now(),
   '{"provider":"email","providers":["email"]}',
   '{"full_name":"Danny Rowe"}', now(), now()),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pm@example.com', now(),
   '{"provider":"email","providers":["email"]}',
   '{"full_name":"Priya Raman"}', now(), now()),
  ('33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'admin@example.com', now(),
   '{"provider":"email","providers":["email"]}',
   '{"full_name":"Site Admin"}', now(), now())
on conflict (id) do nothing;

insert into public.organisations (id, name, code)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'Kingsbridge Civil', 'KBS')
on conflict (id) do nothing;

-- bom_station_id 009225 is PERTH METRO, the closest AWS to the site. Leave it
-- null to let the nearest station be chosen automatically.
insert into public.projects
  (id, org_id, name, code, site_lat, site_lng, bom_station_id, principal_contractor)
values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   'Northern Interchange Stage 2', 'C001', -31.9523, 115.8613, '009225', 'Lendlease')
on conflict (id) do nothing;

insert into public.project_members (project_id, user_id, role) values
  ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'supervisor'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'pm'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'admin')
on conflict (project_id, user_id) do nothing;

-- Transcription vocabulary: the crew list and the area names off the drawing
-- register (brief §4). Plant, suppliers and more areas accumulate on their own
-- as entries are signed — public.project_keyterms() reads them back out.
insert into public.project_keywords (project_id, term, category) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'Danny Rowe',    'person'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'Sam Whitely',   'person'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'Kel Brady',     'person'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'Area B North',  'area'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'Chainage 4200', 'area'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'Pier 3',        'area'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'Hanson',        'supplier'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'Coates',        'supplier')
on conflict (project_id, term) do nothing;
