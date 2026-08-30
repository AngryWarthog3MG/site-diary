import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateGeneratedSql } from './validate.ts';

/**
 * These pin the outermost of four layers. The database is what actually makes
 * generated SQL safe — RLS, a read-only transaction, an empty search_path —
 * and `supabase/tests/06_query_test.sql` pins that half. This half exists to
 * fail early with a readable message, and these tests mostly guard against it
 * failing on queries that are perfectly fine, which is the easier mistake to
 * make and the harder one to notice.
 */

const ok = (sql: string) => {
  const result = validateGeneratedSql(sql);
  assert.ok(result.ok, `rejected a valid query: ${result.reason}\n  ${sql}`);
  return result;
};

const rejected = (sql: string, expect?: RegExp) => {
  const result = validateGeneratedSql(sql);
  assert.equal(result.ok, false, `accepted: ${sql}`);
  if (expect) assert.match(result.reason ?? '', expect);
  return result;
};

// --- the queries a project manager's questions actually become -------------

test('a plain aggregate passes', () => {
  ok('select sum(hours) as total from diary.labour');
});

test('date grouping passes — the single most common question', () => {
  ok(`select extract(month from entry_date) as month, sum(hours) as hours
        from diary.labour group by extract(month from entry_date) order by month`);
});

test('common table expressions pass', () => {
  ok(`with totals as (select entry_no, sum(hours) h from diary.labour group by entry_no)
      select t.entry_no, t.h, e.entry_date
        from diary.entries e join totals t on t.entry_no = e.entry_no`);
});

test('subqueries, joins and lateral pass', () => {
  ok('select * from (select entry_no from diary.pours) p');
  ok(`select e.entry_no, p.volume_m3
        from diary.entries e
        join diary.pours p on p.entry_no = e.entry_no`);
  ok(`select e.entry_no, x.hours
        from diary.entries e
        cross join lateral (select sum(hours) hours from diary.labour l
                             where l.entry_no = e.entry_no) x`);
});

test('text filters pass, and a string containing a keyword does not trip it', () => {
  ok(`select entry_no from diary.delays where cause ilike '%access%'`);
  // "set out" and "created" are ordinary site words, not SQL.
  ok(`select entry_no from diary.work_items where description ilike '%set out%'`);
  ok(`select entry_no from diary.variations where description ilike '%created a delay%'`);
});

test('a fenced query is unwrapped rather than rejected', () => {
  const result = ok('```sql\nselect entry_no from diary.entries\n```');
  assert.equal(result.sql, 'select entry_no from diary.entries');
});

test('a trailing semicolon is tolerated and stripped', () => {
  const result = ok('select entry_no from diary.entries;');
  assert.ok(!result.sql.includes(';'));
});

// --- what it refuses -------------------------------------------------------

test('anything that is not a SELECT is refused', () => {
  rejected('delete from diary.entries', /only select/i);
  rejected('update diary.labour set hours = 0', /only select/i);
  rejected('drop view diary.entries', /only select/i);
  rejected('create table x (a int)', /only select/i);
});

test('a second statement is refused', () => {
  rejected('select 1 from diary.entries; drop table public.entries', /one statement/i);
});

test('a write smuggled into a CTE is refused', () => {
  rejected(
    `with gone as (delete from diary.entries returning 1) select * from gone`,
    /not allowed/i,
  );
});

test('comments are refused — the usual way to smuggle a second intent', () => {
  rejected('select entry_no from diary.entries -- drop everything', /comments/i);
  rejected('select /* sneaky */ entry_no from diary.entries', /comments/i);
});

test('other schemas are refused, whatever they are', () => {
  rejected('select * from auth.users', /diary schema/i);
  rejected('select * from public.entries', /diary schema/i);
  rejected('select * from storage.objects', /diary schema/i);
  rejected('select * from pg_catalog.pg_tables', /diary schema/i);
  rejected('select * from information_schema.columns', /diary schema/i);
});

test('a query touching no diary view at all is refused', () => {
  rejected('select 1', /diary view/i);
  rejected("select current_user", /diary view/i);
});

test('empty and oversized input are refused', () => {
  rejected('', /no query/i);
  rejected('   ', /no query/i);
  rejected(`select ${'x'.repeat(7000)} from diary.entries`, /too long/i);
});

test('SET and RESET are refused — they could undo the role the query runs as', () => {
  rejected('select entry_no from diary.entries where 1=1 reset role', /not allowed/i);
});
