-- ============================================================================
-- 20260907092700_document_search_terms.sql
-- Nearest passages when nothing matches the whole question.
--
-- "What soil amount do I need in the GA01 area" found nothing because GA01
-- is in no uploaded document — and the reply was a blank. More useful: say
-- which words appear nowhere, and show what the documents do say about the
-- rest. This search takes the question's terms one by one, matches each as a
-- code-tolerant pattern (GA01, GA 01, GA-01 are one code), and ranks passages
-- by how many terms they carry. The caller reports the terms with no hits.
-- ============================================================================

create or replace function public.document_search_terms(
  p_project_id uuid,
  p_terms      text[],
  p_limit      integer default 12
)
returns table (
  document_id uuid,
  title       text,
  kind        text,
  revision    text,
  page        integer,
  seq         integer,
  chunk       text,
  matched     integer,
  hit_terms   text[]
)
language sql
stable
security invoker
set search_path = public
as $$
  with pats as (
    -- a letter/digit boundary may carry a space or hyphen in print
    select t as term,
           regexp_replace(regexp_replace(regexp_replace(t, '([[:alpha:]])([[:digit:]])', '\1[[:space:]-]*\2', 'g'),
                                                        '([[:digit:]])([[:alpha:]])', '\1[[:space:]-]*\2', 'g'),
                          '[[:space:]]+', '[[:space:]]+', 'g') as pat
      from unnest(p_terms) as t
     where length(btrim(t)) >= 2
  ),
  hits as (
    select c.id as chunk_id, array_agg(p.term order by p.term) as terms, count(*)::int as n
      from public.project_document_chunks c
      join public.project_documents d on d.id = c.document_id
      join pats p on c.text ~* ('\m' || p.pat)
     where d.project_id = p_project_id and d.status = 'ready'
     group by c.id
  )
  select d.id, d.title, d.kind, d.revision, c.page, c.seq, c.text, h.n, h.terms
    from hits h
    join public.project_document_chunks c on c.id = h.chunk_id
    join public.project_documents d on d.id = c.document_id
   order by h.n desc, d.created_at desc, c.seq
   limit greatest(1, least(p_limit, 40));
$$;
revoke all on function public.document_search_terms(uuid, text[], integer) from public;
grant execute on function public.document_search_terms(uuid, text[], integer) to authenticated, service_role;
