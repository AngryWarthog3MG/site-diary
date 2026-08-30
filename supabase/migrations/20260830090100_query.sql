-- ============================================================================
-- 20260830090100_query.sql
-- The query surface (brief §5).
--
-- Generated SQL does not run against the application tables. It runs against a
-- small schema of purpose-built views, for three reasons:
--
--   1. The prompt can describe the whole surface exactly and briefly. A model
--      given the real schema guesses at joins; given these it does not have to.
--   2. Every row already carries entry_no, entry_date and the project, so
--      every answer can cite entries without the model inventing a join.
--   3. It is a much smaller thing to reason about when the SQL is written by a
--      model from a question typed by a person.
--
-- The views are `security_invoker`, so Row Level Security still applies exactly
-- as it does everywhere else — a PM sees their projects and nothing else.
--
-- THE IMPORTANT PART: these views show the *current record only*. Signed
-- entries, minus any that a later correction supersedes. A draft is not the
-- record, and counting both an entry and the correction that replaced it would
-- double every number in a claim.
-- ============================================================================

create schema if not exists diary;
grant usage on schema diary to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The spine. Every other view hangs off this, so the "current record" rule is
-- defined once.
-- ---------------------------------------------------------------------------
create view diary.entries with (security_invoker = true) as
select
  e.id            as entry_id,
  e.entry_no,
  e.entry_date,
  e.project_id,
  p.name          as project_name,
  p.code          as project_code,
  o.code          as org_code,
  coalesce(pr.full_name, pr.email) as author_name,
  e.signed_at,
  e.transcript_raw,
  prior.entry_no  as supersedes_entry_no
from public.entries e
join public.projects p       on p.id = e.project_id
join public.organisations o  on o.id = p.org_id
left join public.profiles pr on pr.id = e.author_id
left join public.entries prior on prior.id = e.supersedes_entry_id
where e.status = 'signed'
  and not exists (
    select 1 from public.entries later where later.supersedes_entry_id = e.id
  );

comment on view diary.entries is
  'Signed entries that have not been superseded — the current record. Drafts and replaced entries are invisible here on purpose.';

create view diary.labour with (security_invoker = true) as
select d.entry_no, d.entry_date, d.project_id, d.project_name,
       l.person_name, l.role, l.area, l.hours, l.overtime_hours
from public.labour l join diary.entries d on d.entry_id = l.entry_id;

create view diary.plant with (security_invoker = true) as
select d.entry_no, d.entry_date, d.project_id, d.project_name,
       pl.item, pl.hire_type, pl.hours, pl.idle_hours, pl.supplier
from public.plant pl join diary.entries d on d.entry_id = pl.entry_id;

create view diary.work_items with (security_invoker = true) as
select d.entry_no, d.entry_date, d.project_id, d.project_name,
       w.area, w.description, w.percent_complete
from public.work_items w join diary.entries d on d.entry_id = w.entry_id;

create view diary.variations with (security_invoker = true) as
select d.entry_no, d.entry_date, d.project_id, d.project_name,
       v.description, v.directed_by, v.directed_at, v.vr_ref, v.estimated_cost,
       coalesce(array_length(v.photo_urls, 1), 0) as photo_count
from public.variations v join diary.entries d on d.entry_id = v.entry_id;

create view diary.delays with (security_invoker = true) as
select d.entry_no, d.entry_date, d.project_id, d.project_name,
       dl.start_time, dl.end_time, dl.duration_mins, dl.cause,
       dl.personnel_affected, dl.category
from public.delays dl join diary.entries d on d.entry_id = dl.entry_id;

create view diary.pours with (security_invoker = true) as
select d.entry_no, d.entry_date, d.project_id, d.project_name,
       po.location, po.volume_m3, po.mix_spec, po.supplier, po.docket_nos,
       po.start_time, po.finish_time
from public.pours po join diary.entries d on d.entry_id = po.entry_id;

create view diary.quantities with (security_invoker = true) as
select d.entry_no, d.entry_date, d.project_id, d.project_name,
       q.item_type, q.area, q.quantity, q.unit
from public.quantities q join diary.entries d on d.entry_id = q.entry_id;

create view diary.weather with (security_invoker = true) as
select d.entry_no, d.entry_date, d.project_id, d.project_name,
       we.temp_max, we.temp_min, we.rainfall_mm, we.wind_dir, we.wind_kmh,
       we.source, we.observed_impact, we.station_name, we.station_distance_km
from public.weather we join diary.entries d on d.entry_id = we.entry_id;

grant select on all tables in schema diary to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The semantic path (§5): full-text search across the places a supervisor's
-- own words end up, with the matching line quoted back.
-- ---------------------------------------------------------------------------
create or replace function public.diary_search(
  p_query      text,
  p_project_id uuid default null,
  p_limit      integer default 20
)
returns table (
  entry_no     text,
  entry_date   date,
  project_name text,
  field        text,
  snippet      text,
  rank         real
)
language sql
stable
set search_path = ''
as $$
  with q as (select websearch_to_tsquery('english', p_query) as tsq)
  select * from (
    select d.entry_no, d.entry_date, d.project_name, 'transcript'::text as field,
           ts_headline('english', d.transcript_raw, q.tsq,
                       'MaxFragments=2, MinWords=8, MaxWords=26, StartSel=<<, StopSel=>>') as snippet,
           ts_rank(to_tsvector('english', coalesce(d.transcript_raw, '')), q.tsq) as rank
      from diary.entries d, q
     where d.transcript_raw is not null
       and to_tsvector('english', d.transcript_raw) @@ q.tsq
       and (p_project_id is null or d.project_id = p_project_id)

    union all
    select w.entry_no, w.entry_date, w.project_name, 'works completed',
           ts_headline('english', w.description, q.tsq,
                       'MaxFragments=1, MinWords=6, MaxWords=24, StartSel=<<, StopSel=>>'),
           ts_rank(to_tsvector('english', w.description), q.tsq)
      from diary.work_items w, q
     where to_tsvector('english', w.description) @@ q.tsq
       and (p_project_id is null or w.project_id = p_project_id)

    union all
    select v.entry_no, v.entry_date, v.project_name, 'variation',
           ts_headline('english', v.description, q.tsq,
                       'MaxFragments=1, MinWords=6, MaxWords=24, StartSel=<<, StopSel=>>'),
           ts_rank(to_tsvector('english', v.description), q.tsq)
      from diary.variations v, q
     where to_tsvector('english', v.description) @@ q.tsq
       and (p_project_id is null or v.project_id = p_project_id)

    union all
    select dl.entry_no, dl.entry_date, dl.project_name, 'delay',
           ts_headline('english', dl.cause, q.tsq,
                       'MaxFragments=1, MinWords=6, MaxWords=24, StartSel=<<, StopSel=>>'),
           ts_rank(to_tsvector('english', dl.cause), q.tsq)
      from diary.delays dl, q
     where dl.cause is not null
       and to_tsvector('english', dl.cause) @@ q.tsq
       and (p_project_id is null or dl.project_id = p_project_id)
  ) hits
  order by hits.rank desc, hits.entry_date desc, hits.entry_no
  limit least(greatest(coalesce(p_limit, 20), 1), 100);
$$;

comment on function public.diary_search(text, uuid, integer) is
  'Full-text search over the supervisor''s own words. SECURITY INVOKER, so it only ever searches entries the caller can already read.';

grant execute on function public.diary_search(text, uuid, integer) to authenticated, service_role;

-- ============================================================================
-- Running generated SQL.
--
-- The security model here is deliberately not "we validated the string". It is:
--
--   1. SECURITY INVOKER. The query runs as the signed-in user, so Row Level
--      Security applies to every table it can reach. The worst a generated
--      query can do is read rows the person could already read.
--   2. Called over PostgREST with GET against a STABLE function, which
--      PostgREST executes in a READ ONLY transaction. Writes and DDL fail at
--      the transaction level regardless of what the string says.
--   3. A statement timeout and a hard row cap, so a bad join cannot take the
--      database with it.
--
-- The string checks below are a fourth layer, not the first. They catch
-- obvious nonsense early and give a better error than a syntax failure would;
-- they are not what makes this safe.
-- ============================================================================

create or replace function public.run_diary_query(p_sql text, p_limit integer default 200)
returns jsonb
language plpgsql
stable
set search_path = ''
set statement_timeout = '8s'
as $$
declare
  v_sql   text := btrim(coalesce(p_sql, ''));
  v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 1000);
  v_rows  jsonb;
begin
  if length(v_sql) = 0 then
    raise exception 'No query was given.' using errcode = 'check_violation';
  end if;
  if length(v_sql) > 6000 then
    raise exception 'That query is too long to run.' using errcode = 'check_violation';
  end if;

  -- A trailing semicolon is tidy; anything else is a second statement.
  v_sql := btrim(regexp_replace(v_sql, ';\s*$', ''));
  if position(';' in v_sql) > 0 then
    raise exception 'Only one statement can be run at a time.' using errcode = 'check_violation';
  end if;

  if v_sql !~* '^(with|select)\s' then
    raise exception 'Only SELECT queries can be run here.' using errcode = 'check_violation';
  end if;

  -- Comments are the usual way of smuggling a second intent past a check.
  if v_sql ~ '(--|/\*)' then
    raise exception 'Comments are not allowed in a query.' using errcode = 'check_violation';
  end if;

  -- Only the diary schema is reachable, and the mechanism matters.
  --
  -- `search_path` is empty on this function, so an unqualified `from entries`
  -- does not resolve to anything at all — every real relation has to be
  -- schema-qualified. That leaves one thing to check: that the qualifier is
  -- never a schema we do not want read. Common table expressions and column
  -- aliases are unqualified or alias-qualified, so they are untouched by this.
  --
  -- An earlier version required every FROM to be `diary.`-prefixed, which
  -- rejected `from my_cte` and, worse, `extract(month from entry_date)` — the
  -- single most useful thing a PM asks for.
  if v_sql ~* '\m(public|auth|storage|extensions|graphql|graphql_public|realtime|vault|pgsodium|supabase_functions|information_schema|pg_catalog|pg_temp|pg_toast|cron|net|app|tests)\s*\.' then
    raise exception 'Queries may only read from the diary schema.'
      using errcode = 'check_violation';
  end if;

  execute format(
    'select coalesce(jsonb_agg(row_to_json(capped)), ''[]''::jsonb)
       from (select * from (%s) generated limit %s) capped',
    v_sql, v_limit
  ) into v_rows;

  return jsonb_build_object('rows', v_rows, 'row_count', jsonb_array_length(v_rows));
end;
$$;

comment on function public.run_diary_query(text, integer) is
  'Runs a generated SELECT against the diary schema as the calling user. Safe because of RLS and PostgREST''s read-only GET transaction, not because of the string checks.';

grant execute on function public.run_diary_query(text, integer) to authenticated, service_role;
