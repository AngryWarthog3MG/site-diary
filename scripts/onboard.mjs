/**
 * Stand up a new site.
 *
 *   npm run onboard -- \
 *     --org "Kingsbridge Civil" --org-code KBS \
 *     --project "Northern Interchange Stage 2" --project-code C001 \
 *     --admin boss@kingsbridge.com.au \
 *     --lat -31.9523 --lng 115.8613 \
 *     --contractor "Lendlease" \
 *     --supervisor danny@kingsbridge.com.au --supervisor sam@kingsbridge.com.au \
 *     --pm priya@kingsbridge.com.au \
 *     --crew "Danny Rowe" --crew "Sam Whitely"
 *
 * Everyone named must have signed in to the app at least once — the magic link
 * is what creates their account. Anyone who has not is reported and skipped,
 * and re-running later picks them up: the whole thing is idempotent, so it is
 * also how you add crew to an existing site.
 *
 * Arguments are passed as typed RPC parameters, never interpolated into SQL.
 *
 * Needs SUPABASE_SERVICE_ROLE_KEY, because creating an organisation is
 * deliberately impossible from a browser session — see the migration.
 */
import { createClient } from '@supabase/supabase-js';

const REPEATABLE = new Set(['supervisor', 'pm', 'crew']);
/** Flags that stand alone. Without this they are read as expecting a value. */
const BOOLEAN = new Set(['create-accounts', 'help']);

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    if (BOOLEAN.has(key)) {
      out[key] = true;
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      console.error(`--${key} needs a value.`);
      process.exit(1);
    }
    i += 1;
    if (REPEATABLE.has(key)) (out[key] ??= []).push(value);
    else out[key] = value;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

const REQUIRED = ['org', 'org-code', 'project', 'project-code', 'admin'];
const missing = REQUIRED.filter((key) => !args[key]);
if (missing.length || args.help) {
  console.error(
    `Stand up a new site.\n\n` +
      `Required:  ${REQUIRED.map((k) => `--${k}`).join('  ')}\n` +
      `Optional:  --lat --lng --contractor --station\n` +
      `           --create-accounts  provision accounts for anyone without one,\n` +
      `                              so they can be signed in with a QR code\n` +
      `Repeatable: --supervisor --pm --crew\n\n` +
      (missing.length ? `Missing: ${missing.map((k) => `--${k}`).join(', ')}\n` : ''),
  );
  process.exit(missing.length ? 1 : 0);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error(
    'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.\n' +
      'Both are in the Supabase dashboard under Project Settings -> API.\n' +
      'Put them in .env.local — the service role key bypasses every policy in\n' +
      'the database, so it must never reach a browser or a git commit.\n',
  );
  process.exit(1);
}

const number = (value) => (value === undefined ? null : Number(value));

/**
 * Provision accounts for people who have none.
 *
 * Normally an account comes into existence when someone signs in, and that is
 * the right default — nobody should be added to a diary they never asked to
 * join. But signing in needs email, email needs a verified sending domain, and
 * until that exists a crew cannot get on at all.
 *
 * So this is opt-in and explicit: --create-accounts provisions the addresses
 * you name, marked as confirmed, so `npm run signin --qr` can get each of them
 * onto the app by scanning a code. It is account creation on someone else's
 * behalf, which is why it is a flag you have to type rather than something
 * that happens quietly.
 */
async function provision(client, emails) {
  const made = [];
  for (const email of emails) {
    const address = email.trim().toLowerCase();
    if (!address) continue;

    const { data: existing } = await client.auth.admin.listUsers({ perPage: 200 });
    if (existing?.users?.some((u) => (u.email ?? '').toLowerCase() === address)) continue;

    const { error } = await client.auth.admin.createUser({
      email: address,
      email_confirm: true,
    });
    made.push({ email: address, ok: !error, error: error?.message });
  }
  return made;
}

const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

if (args['create-accounts']) {
  const everyone = [args.admin, ...(args.supervisor ?? []), ...(args.pm ?? [])];
  const made = await provision(supabase, everyone);
  if (made.length) {
    console.log('\n  Accounts created:');
    for (const m of made) {
      console.log(`    ${m.ok ? '' : 'FAILED '}${m.email}${m.error ? ' — ' + m.error : ''}`);
    }
  } else {
    console.log('\n  Everyone named already has an account.');
  }
}

const { data, error } = await supabase.rpc('onboard_project', {
  p_org_name: args.org,
  p_org_code: args['org-code'],
  p_project_name: args.project,
  p_project_code: args['project-code'],
  p_admin_email: args.admin,
  p_site_lat: number(args.lat),
  p_site_lng: number(args.lng),
  p_principal_contractor: args.contractor ?? null,
  p_bom_station_id: args.station ?? null,
  p_supervisors: args.supervisor ?? [],
  p_pms: args.pm ?? [],
  p_crew: args.crew ?? [],
});

if (error) {
  console.error(`\nOnboarding failed: ${error.message}`);
  if (error.hint) console.error(`Hint: ${error.hint}`);
  process.exit(1);
}

const { organisation, project, members, no_account_yet: pending, crew_keywords } = data;

console.log(`\n  ${organisation.name} (${organisation.code})`);
console.log(`  ${project.name} — ${organisation.code}_${project.code}`);
console.log(`  First entry will be ${project.next_entry_no}`);
console.log(`\n  Seated:`);
for (const member of members) console.log(`    ${member.role.padEnd(11)} ${member.email}`);
console.log(`\n  ${crew_keywords} crew names in the transcription vocabulary`);

if (pending.length > 0) {
  console.log(`\n  Not seated — no account yet:`);
  for (const email of pending) console.log(`    ${email}`);
  console.log(
    `\n  They need to sign in to the app once, then run this again with the\n` +
      `  same arguments to pick them up — or re-run with --create-accounts and\n` +
      `  give each of them a QR from: npm run signin -- --email <them> --qr`,
  );
}

console.log('');
