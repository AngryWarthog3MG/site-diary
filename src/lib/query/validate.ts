/**
 * Client-side validation of generated SQL.
 *
 * This is the outermost of four layers and the least important of them. What
 * actually makes running generated SQL safe is in the database:
 *
 *   1. The function is SECURITY INVOKER, so the query runs as the signed-in
 *      user and Row Level Security applies. The worst it can reach is rows the
 *      person could already read.
 *   2. It is STABLE and called over GET, which PostgREST runs in a READ ONLY
 *      transaction — writes and DDL fail at the transaction level whatever the
 *      string says.
 *   3. Its search_path is empty, so an unqualified table name resolves to
 *      nothing and every real relation has to be schema-qualified.
 *   4. A statement timeout and a row cap.
 *
 * This function exists to fail early with a message worth reading, and to keep
 * an obviously wrong query from being run at all. It is not the security
 * boundary and should never be treated as one.
 */

const FORBIDDEN_SCHEMAS = [
  'public', 'auth', 'storage', 'extensions', 'graphql', 'graphql_public',
  'realtime', 'vault', 'pgsodium', 'supabase_functions', 'information_schema',
  'pg_catalog', 'pg_temp', 'pg_toast', 'cron', 'net', 'app', 'tests',
];

const FORBIDDEN_KEYWORDS = [
  'insert', 'update', 'delete', 'drop', 'alter', 'create', 'truncate', 'grant',
  'revoke', 'copy', 'vacuum', 'analyze', 'reindex', 'cluster', 'comment',
  'call', 'do', 'execute', 'prepare', 'listen', 'notify', 'lock', 'reset',
  'set', 'begin', 'commit', 'rollback', 'savepoint', 'refresh',
];

export interface SqlCheck {
  ok: boolean;
  sql: string;
  reason?: string;
}

export function validateGeneratedSql(input: string): SqlCheck {
  let sql = (input ?? '').trim();

  // Models like a fence even when told not to use one.
  sql = sql.replace(/^```(?:sql)?\s*/i, '').replace(/```$/, '').trim();
  sql = sql.replace(/;\s*$/, '').trim();

  if (!sql) return { ok: false, sql, reason: 'No query was produced.' };
  if (sql.length > 6000) {
    return { ok: false, sql, reason: 'That query is too long to run.' };
  }
  if (!/^(with|select)\s/i.test(sql)) {
    return { ok: false, sql, reason: 'Only SELECT queries can be run.' };
  }
  if (sql.includes(';')) {
    return { ok: false, sql, reason: 'Only one statement can be run at a time.' };
  }
  if (/--|\/\*/.test(sql)) {
    return { ok: false, sql, reason: 'Comments are not allowed in a query.' };
  }

  const schema = new RegExp(`\\b(${FORBIDDEN_SCHEMAS.join('|')})\\s*\\.`, 'i');
  if (schema.test(sql)) {
    return { ok: false, sql, reason: 'Queries may only read from the diary schema.' };
  }

  // A keyword check catches a query that is trying to do something other than
  // read, before the database has to refuse it. String literals are stripped
  // first so a delay cause of "waiting on the set out" is not mistaken for SET.
  const withoutStrings = sql.replace(/'(?:[^']|'')*'/g, "''");
  const keyword = new RegExp(`\\b(${FORBIDDEN_KEYWORDS.join('|')})\\b`, 'i');
  const found = keyword.exec(withoutStrings);
  if (found) {
    return { ok: false, sql, reason: `"${found[1].toUpperCase()}" is not allowed in a query.` };
  }

  if (!/\bdiary\.\w+/i.test(sql)) {
    return { ok: false, sql, reason: 'The query does not read from any diary view.' };
  }

  return { ok: true, sql };
}
