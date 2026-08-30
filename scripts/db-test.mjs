/**
 * Run the SQL suites against a real database.
 *
 *   npm run db:test                     # uses $DATABASE_URL
 *   DATABASE_URL=... npm run db:test
 *   npm run db:test -- 03 05            # only suites whose name contains these
 *
 * Every suite opens a transaction and rolls it back, so this is safe to run
 * against a database with data in it — but it does exercise triggers and
 * policies, so point it at a development project first.
 *
 * Deliberately not psql: the suites are plain SQL with no meta-commands, and
 * requiring a local Postgres install to check the schema put the one thing
 * most worth running behind a dependency nobody has.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error(
    'DATABASE_URL is not set.\n\n' +
      '  Hosted:  npx supabase link --project-ref <ref>\n' +
      '           then copy the connection string from the Supabase dashboard\n' +
      '           (Project Settings -> Database -> Connection string -> URI)\n' +
      '  Local:   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres\n',
  );
  process.exit(1);
}

const filters = process.argv.slice(2);
const dir = 'supabase/tests';
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .filter((f) => filters.length === 0 || filters.some((needle) => f.includes(needle)))
  .sort();

if (files.length === 0) {
  console.error(`No suites matched ${filters.join(', ')}`);
  process.exit(1);
}

const client = new pg.Client({
  connectionString: url,
  // Supabase's pooler presents a certificate for its own host.
  ssl: url.includes('localhost') || url.includes('127.0.0.1')
    ? false
    : { rejectUnauthorized: false },
});

client.on('notice', (n) => {
  const message = (n.message ?? '').trim();
  if (message) console.log(`   ${message}`);
});

await client.connect();

let failed = 0;
for (const file of files) {
  const full = path.join(dir, file);
  try {
    await client.query(readFileSync(full, 'utf8'));
    console.log(`OK   ${file}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL ${file}`);
    console.log(`     ${error.message}`);
    if (error.where) console.log(`     where: ${String(error.where).split('\n')[0]}`);
    if (error.detail) console.log(`     detail: ${error.detail}`);
    if (error.hint) console.log(`     hint: ${error.hint}`);
    // A failed suite leaves its transaction aborted; clear it before the next.
    await client.query('rollback').catch(() => {});
  }
}

await client.end();

console.log(
  failed === 0
    ? `\nAll ${files.length} suite${files.length === 1 ? '' : 's'} passed.`
    : `\n${failed} of ${files.length} suites failed.`,
);
process.exit(failed === 0 ? 0 : 1);
