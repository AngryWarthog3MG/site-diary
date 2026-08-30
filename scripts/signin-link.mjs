/**
 * Open a sign-in link without sending an email.
 *
 *   npm run signin -- --email danny@kingsbridge.com.au
 *
 * Supabase's built-in mail provider allows only a handful of messages an hour,
 * which is enough to stop a day's testing dead. This mints the same link the
 * email would have carried, using the Admin API, and opens it directly — no
 * message is sent and no limit applies.
 *
 * It deliberately builds the URL against /auth/confirm with a token_hash,
 * rather than using the action_link Supabase returns, so it exercises exactly
 * the path a real magic link will take once custom SMTP is configured.
 *
 * The link is a single-use credential, so it is opened rather than printed.
 *
 * Operator tool. Needs SUPABASE_SERVICE_ROLE_KEY, which is read from
 * .env.local and never displayed.
 */
import { execFile } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

// A flag with nothing after it, or followed by another flag, is a boolean.
// Parsed as a value it came out `undefined`, which made `--check` silently do
// the opposite of what it says.
const args = Object.fromEntries(
  process.argv
    .slice(2)
    .map((token, index, all) => {
      if (!token.startsWith('--')) return null;
      const next = all[index + 1];
      return [token.slice(2), next === undefined || next.startsWith('--') ? true : next];
    })
    .filter(Boolean),
);

const email = args.email;
if (!email) {
  console.error('Usage: npm run signin -- --email someone@example.com');
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const site = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

if (!url || !key) {
  console.error(
    'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be in .env.local.\n' +
      'The service role key is in the dashboard under Project Settings -> API.\n',
  );
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data, error } = await supabase.auth.admin.generateLink({ type: 'magiclink', email });

if (error) {
  console.error(`Could not mint a link for ${email}: ${error.message}`);
  if (/not found/i.test(error.message)) {
    console.error('That address has no account yet.');
  }
  process.exit(1);
}

const token = data?.properties?.hashed_token;
if (!token) {
  console.error('Supabase returned no token.');
  process.exit(1);
}

const link = `${site}/auth/confirm?token_hash=${encodeURIComponent(token)}&type=magiclink&next=%2F`;

/**
 * --check spends the link here instead of opening it, and reports what the
 * resulting session can actually see. Worth running for each new supervisor:
 * it answers "can they sign in, and is their project there when they do" in
 * one step, rather than finding out when they are standing on site.
 */
if (args.check !== undefined) {
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!anonKey) {
    console.error('NEXT_PUBLIC_SUPABASE_ANON_KEY must be set to run --check.');
    process.exit(1);
  }

  const asUser = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: session, error: verifyError } = await asUser.auth.verifyOtp({
    type: 'magiclink',
    token_hash: token,
  });

  if (verifyError || !session?.user) {
    console.error(`\n  Sign-in FAILED for ${email}: ${verifyError?.message ?? 'no session'}\n`);
    process.exit(1);
  }

  console.log(`\n  Sign-in OK — ${session.user.email}`);

  // Everything below reads under that user's own RLS, exactly as the app will.
  // Scoped to this user. Project members can see their co-members by design,
  // so an unfiltered query lists everyone — and the check then reports the
  // wrong role for the very person it was asked about.
  const { data: memberships, error: membershipError } = await asUser
    .from('project_members')
    .select('role, project:projects!inner(name, code, site_lat, org:organisations!inner(code))')
    .eq('user_id', session.user.id);

  if (membershipError) {
    console.error(`  Could not read memberships: ${membershipError.message}`);
    process.exit(1);
  }

  if (!memberships?.length) {
    console.error('  No projects. They can sign in but the app will have nothing to show.');
    process.exit(1);
  }

  for (const m of memberships) {
    const p = Array.isArray(m.project) ? m.project[0] : m.project;
    const org = Array.isArray(p.org) ? p.org[0] : p.org;
    console.log(`  ${m.role.padEnd(11)} ${org.code}_${p.code}  ${p.name}`);
    if (p.site_lat == null) console.log('              (no site coordinates — weather will be unavailable)');
  }

  await asUser.auth.signOut();
  console.log('');
  process.exit(0);
}

/**
 * --qr writes the link as a QR image and opens it.
 *
 * This is how a supervisor gets onto a test build without email: the built-in
 * mail provider is rate limited to a handful an hour, and its stock template
 * sends a PKCE link that fails inside a phone's in-app mail browser anyway.
 *
 * An image rather than terminal blocks. A terminal QR renders inverted on a
 * dark colour scheme — light modules on a dark ground — and most scanners
 * refuse to read that. A PNG has the contrast and the quiet zone the spec
 * expects, whatever the terminal is set to.
 *
 * The image signs whoever scans it in as this user, so it goes to a file and a
 * viewer, never to stdout.
 */
if (args.qr) {
  const QRCode = (await import('qrcode')).default;
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');

  const file = path.join(tmpdir(), `site-diary-signin-${Date.now()}.png`);
  await QRCode.toFile(file, link, {
    width: 640,
    margin: 3,
    errorCorrectionLevel: 'M',
    color: { dark: '#131A1E', light: '#FFFFFF' },
  });

  execFile('open', [file], (err) => {
    if (err) {
      console.error(`Could not open the image: ${err.message}`);
      console.error(`It is at ${file}`);
      process.exit(1);
    }
    console.log(`\n  Scan the QR that just opened to sign in as ${email}.`);
    console.log('  Single use, and it expires. Run this again for another.');
    console.log(`  Delete it when you are done: ${file}\n`);
  });
} else {

  // Opened, not printed: it signs whoever holds it in as this user.
  execFile('open', [link], (err) => {
    if (err) {
      console.error(`Could not open a browser automatically: ${err.message}`);
      process.exit(1);
    }
    console.log(`\n  Signing in as ${email} — the browser should be opening now.`);
    console.log('  The link is single use. Run this again for another.\n');
  });
}
