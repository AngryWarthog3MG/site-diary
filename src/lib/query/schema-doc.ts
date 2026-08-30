/**
 * The schema the model writes SQL against.
 *
 * Deliberately not the real one. `diary` is a small set of read-only views
 * built for this: every row already carries entry_no, entry_date and the
 * project, so a question about totals needs no joins and every answer can cite
 * entries without the model working out how.
 *
 * Kept in step with supabase/migrations/20260830090100_query.sql by hand, and
 * by a test that asks the database what the views actually expose.
 */

export const QUERY_SCHEMA_VERSION = 'diary-v1';

export const DIARY_SCHEMA_DOC = `Every view lives in the "diary" schema and must be written as diary.<view>.
Unqualified table names do not resolve. Only these views exist.

diary.entries        entry_no text, entry_date date, project_id uuid, project_name text,
                     project_code text, org_code text, author_name text, signed_at timestamptz,
                     transcript_raw text, supersedes_entry_no text
diary.labour         entry_no, entry_date, project_id, project_name,
                     person_name text, role text, area text, hours numeric, overtime_hours numeric
diary.plant          entry_no, entry_date, project_id, project_name,
                     item text, hire_type text ('wet'|'dry'), hours numeric, idle_hours numeric,
                     supplier text
diary.work_items     entry_no, entry_date, project_id, project_name,
                     area text, description text, percent_complete numeric
diary.variations     entry_no, entry_date, project_id, project_name,
                     description text, directed_by text, directed_at timestamptz, vr_ref text,
                     estimated_cost numeric, photo_count integer
diary.delays         entry_no, entry_date, project_id, project_name,
                     start_time time, end_time time, duration_mins integer, cause text,
                     personnel_affected integer,
                     category text ('weather'|'access'|'design'|'other')
diary.pours          entry_no, entry_date, project_id, project_name,
                     location text, volume_m3 numeric, mix_spec text, supplier text,
                     docket_nos text[], start_time time, finish_time time
diary.quantities     entry_no, entry_date, project_id, project_name,
                     item_type text, area text, quantity numeric, unit text
diary.weather        entry_no, entry_date, project_id, project_name,
                     temp_max numeric, temp_min numeric, rainfall_mm numeric, wind_dir text,
                     wind_kmh numeric, source text ('bom_auto'|'manual'), observed_impact text,
                     station_name text, station_distance_km numeric

What these views contain, and what they do not:

- Signed entries only. A draft is not the record.
- Superseded entries are excluded. When a correction replaces an earlier entry,
  only the correction is here — so totals never count a day twice.
- Row Level Security is already applied. Do not filter by user or add any
  permission check; the caller can only see their own projects either way.

Notes that matter for getting numbers right:

- A "rain day" is a row in diary.weather with rainfall_mm > 0. Do not infer rain
  from a delay's category.
- Labour hours are diary.labour.hours; overtime is a separate column and is not
  included in it. Add them only if the question asks for total time on site.
- Concrete volume is diary.pours.volume_m3, already in cubic metres.
- diary.quantities is generic: filter by item_type for a particular material.
- Time lost to a delay is duration_mins, which may be null even when start_time
  and end_time are set.`;

/**
 * Rules for writing the SQL itself. Separate from the schema so the schema can
 * change without touching the instructions and the other way round.
 */
export const SQL_RULES = `Write one PostgreSQL SELECT statement, and nothing else.

- One statement. No semicolon, no comments, no CTE that writes.
- Read only from diary.* views. Common table expressions are fine.
- Always include entry_no in the result unless the question is purely an
  aggregate over many entries — the answer has to cite the entries it came from.
- When aggregating, also return the count of entries involved so the answer can
  say how many days it covers.
- Order results in a way that makes the answer readable: by date, or by the
  value being ranked.
- Use ILIKE for text matching, never LIKE.
- Never invent a column. If the question needs something the schema does not
  have, return a query for the closest thing it does have.`;
