-- ============================================================================
-- 20260907092600_project_documents.sql
-- The job's documents, readable by Ask.
--
-- Specification, scope, contract, drawings register, safety plan: the papers
-- a job runs on. Uploaded once per project (revisions kept), read into text on
-- the server, and searched by the Ask screen so "what depth is the topsoil at
-- the bus port" is answered from the spec with the clause cited.
--
-- Reference material, not the record. Nothing here touches an entry, a signed
-- row or the content hash; a document answers a question, it never fills a
-- diary field.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('project-documents', 'project-documents', false, 52428800,
  array['application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'image/jpeg', 'image/png', 'image/webp', 'text/plain'])
on conflict (id) do nothing;

-- Paths are {project_id}/documents/{document_id}/{filename}; the first folder
-- is the project, exactly as for entry media.
create policy "project documents readable by project members" on storage.objects
  for select to authenticated
  using (bucket_id = 'project-documents' and app.is_project_member(app.storage_project_id(name)));
create policy "project documents writable by project members" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'project-documents' and app.is_project_member(app.storage_project_id(name)));
create policy "project documents deletable by project members" on storage.objects
  for delete to authenticated
  using (bucket_id = 'project-documents' and app.is_project_member(app.storage_project_id(name)));

create table public.project_documents (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects (id) on delete restrict,
  title         text not null check (length(btrim(title)) > 0),
  kind          text not null default 'other'
                check (kind in ('specification', 'scope', 'contract', 'drawing', 'safety', 'programme', 'other')),
  revision      text,
  filename      text not null,
  storage_path  text not null,
  mime_type     text not null,
  bytes         integer not null check (bytes >= 0),
  pages         integer,
  chars         integer not null default 0,
  -- uploaded → indexing → ready | failed. The server moves it; the screen reads it.
  status        text not null default 'uploaded' check (status in ('uploaded', 'indexing', 'ready', 'failed')),
  error         text,
  -- how the text was got: 'pdf-text', 'docx', 'vision', 'plain'
  method        text,
  uploaded_by   uuid not null references auth.users (id),
  created_at    timestamptz not null default now(),
  indexed_at    timestamptz
);
create index project_documents_project_idx on public.project_documents (project_id, created_at desc);

create table public.project_document_chunks (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.project_documents (id) on delete cascade,
  page        integer,
  seq         integer not null,
  text        text not null,
  tsv         tsvector generated always as (to_tsvector('english', text)) stored
);
create index project_document_chunks_document_idx on public.project_document_chunks (document_id, seq);
create index project_document_chunks_tsv_idx on public.project_document_chunks using gin (tsv);

comment on table public.project_documents is
  'The job''s reference documents (spec, scope, contract, drawings). Read into chunks for Ask. Never part of a signed record.';

alter table public.project_documents enable row level security;
alter table public.project_document_chunks enable row level security;

create policy project_documents_select_member on public.project_documents
  for select to authenticated using (app.is_project_member(project_id));
create policy project_documents_insert_member on public.project_documents
  for insert to authenticated
  with check (app.is_project_member(project_id) and uploaded_by = auth.uid());
create policy project_documents_update_member on public.project_documents
  for update to authenticated
  using (app.is_project_member(project_id)) with check (app.is_project_member(project_id));
create policy project_documents_delete_member on public.project_documents
  for delete to authenticated using (app.is_project_member(project_id));
create policy project_document_chunks_select_member on public.project_document_chunks
  for select to authenticated using (exists (
    select 1 from public.project_documents d where d.id = document_id and app.is_project_member(d.project_id)));

grant select, insert, update, delete on public.project_documents to authenticated;
grant select on public.project_document_chunks to authenticated;
grant all on public.project_documents, public.project_document_chunks to service_role;

-- ---------------------------------------------------------------------------
-- Search. Full text first; a plain phrase match as the fallback for codes and
-- numbers the stemmer mangles ("AS 4419", "300mm"). Runs as the caller, so RLS
-- decides what is visible.
-- ---------------------------------------------------------------------------
create or replace function public.document_search(
  p_project_id uuid,
  p_query      text,
  p_limit      integer default 12,
  p_plain      boolean default false
)
returns table (
  document_id uuid,
  title       text,
  kind        text,
  revision    text,
  page        integer,
  seq         integer,
  chunk       text,
  snippet     text,
  rank        real
)
language sql
stable
security invoker
set search_path = public
as $$
  with q as (select websearch_to_tsquery('english', p_query) as tsq)
  select d.id, d.title, d.kind, d.revision, c.page, c.seq, c.text,
         case when p_plain then left(c.text, 240)
              else ts_headline('english', c.text, q.tsq,
                     'StartSel=<<, StopSel=>>, MaxWords=40, MinWords=20, MaxFragments=2') end,
         case when p_plain then 0.1::real else ts_rank(c.tsv, q.tsq) end
    from public.project_document_chunks c
    join public.project_documents d on d.id = c.document_id
    cross join q
   where d.project_id = p_project_id
     and d.status = 'ready'
     and ((not p_plain and c.tsv @@ q.tsq)
          or (p_plain and c.text ilike '%' || p_query || '%'))
   order by 9 desc, d.created_at desc, c.seq
   limit greatest(1, least(p_limit, 40));
$$;
revoke all on function public.document_search(uuid, text, integer, boolean) from public;
grant execute on function public.document_search(uuid, text, integer, boolean) to authenticated, service_role;
