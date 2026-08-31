/**
 * Open a sign-in link without sending an email.
 *
 *   npm run signin -- --email danny@kingsbridge.com.au
 *   npm run signin -- --project KBS_C001 --qr-pack
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

const email = typeof args.email === 'string' ? args.email.trim().toLowerCase() : null;
const projectRef = typeof args.project === 'string' ? args.project.trim() : null;

if (!email && !projectRef) {
  console.error(
    'Usage:\n' +
      '  npm run signin -- --email someone@example.com [--qr] [--check]\n' +
      '  npm run signin -- --project KBS_C001 --qr-pack [--role supervisor]\n',
  );
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

async function magicCredential(address) {
  const { data, error } = await supabase.auth.admin.generateLink({
    type: 'magiclink',
    email: address,
  });

  if (error) {
    throw error;
  }
  const token = data?.properties?.hashed_token;
  if (!token) throw new Error('Supabase returned no token.');
  return {
    token,
    link: `${site}/auth/confirm?token_hash=${encodeURIComponent(token)}&type=magiclink&next=%2F`,
  };
}

function projectLabel(project) {
  const org = Array.isArray(project.org) ? project.org[0] : project.org;
  return `${org.code}_${project.code}`;
}

async function findProject(ref) {
  const { data: projects, error } = await supabase
    .from('projects')
    .select('id, name, code, active, org:organisations!inner(code)')
    .eq('active', true);

  if (error) throw new Error(`Could not read projects: ${error.message}`);

  const normal = ref.toUpperCase().replace(/-/g, '_');
  const matches = (projects ?? []).filter((project) => {
    const label = projectLabel(project).toUpperCase();
    return project.id === ref || label === normal || project.code.toUpperCase() === normal;
  });

  if (matches.length === 0) throw new Error(`No active project matched ${ref}. Try ORG_PROJECT, e.g. KBS_C001.`);
  if (matches.length > 1) throw new Error(`${ref} matched more than one project. Use ORG_PROJECT or the project id.`);
  return matches[0];
}

async function projectMembers(projectId, role) {
  // Members first, then ONE filtered profiles query for exactly those ids.
  // The old version pulled the whole profiles table plus the first 1000 auth
  // users — and silently dropped any member past page one as the user base
  // grew. profiles carries the email, so listUsers is not needed at all.
  const { data: members, error: memberError } = await supabase
    .from('project_members')
    .select('user_id, role')
    .eq('project_id', projectId)
    .order('role');
  if (memberError) throw new Error(`Could not read project members: ${memberError.message}`);

  const wanted = (members ?? []).filter((member) => !role || member.role === role);
  if (wanted.length === 0) return [];

  const { data: profiles, error: profileError } = await supabase
    .from('profiles')
    .select('id, full_name, email')
    .in('id', wanted.map((member) => member.user_id));
  if (profileError) throw new Error(`Could not read profiles: ${profileError.message}`);

  const profileById = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
  return wanted
    .map((member) => {
      const profile = profileById.get(member.user_id);
      return {
        id: member.user_id,
        role: member.role,
        name: profile?.full_name ?? profile?.email ?? member.user_id,
        email: (profile?.email ?? '').toLowerCase(),
      };
    })
    .filter((member) => member.email);
}

function safeName(value) {
  return value.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'member';
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

if (args['qr-pack'] !== undefined) {
  if (!projectRef) {
    console.error('--qr-pack needs --project ORG_PROJECT.');
    process.exit(1);
  }

  const role = typeof args.role === 'string' ? args.role : null;
  if (role && !['supervisor', 'pm', 'admin'].includes(role)) {
    console.error('--role must be supervisor, pm, or admin.');
    process.exit(1);
  }

  try {
    const QRCode = (await import('qrcode')).default;
    const { mkdtemp, writeFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const path = await import('node:path');

    const project = await findProject(projectRef);
    const label = projectLabel(project);
    const members = await projectMembers(project.id, role);
    if (members.length === 0) throw new Error(`No ${role ?? 'project'} members with email addresses found for ${label}.`);

    const dir = await mkdtemp(path.join(tmpdir(), `site-diary-${safeName(label)}-qr-`));
    const cards = [];
    for (const member of members) {
      const { link } = await magicCredential(member.email);
      const fileName = `${safeName(member.role)}-${safeName(member.email)}.png`;
      const file = path.join(dir, fileName);
      await QRCode.toFile(file, link, {
        width: 640,
        margin: 3,
        errorCorrectionLevel: 'M',
        color: { dark: '#131A1E', light: '#FFFFFF' },
      });
      cards.push({ ...member, fileName });
    }

    const index = path.join(dir, 'index.html');
    await writeFile(
      index,
      `<!doctype html>
<html lang="en-AU">
<head>
  <meta charset="utf-8">
  <title>Site Diary QR pack - ${escapeHtml(label)}</title>
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #131A1E; background: #F1F2EF; }
    main { max-width: 920px; margin: 0 auto; padding: 32px 24px; }
    h1 { margin: 0; font-size: 24px; }
    p { color: #5A6469; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px; }
    .card { break-inside: avoid; background: white; border: 1px solid rgba(19,26,30,.12); padding: 16px; }
    img { width: 100%; height: auto; display: block; }
    .role { margin: 8px 0 0; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color: #0E4F52; }
    .name { margin: 2px 0 0; font-weight: 700; color: #131A1E; }
    .email { margin: 2px 0 0; font-family: ui-monospace, Menlo, monospace; font-size: 12px; }
    @media print { body { background: white; } main { padding: 0; } .card { page-break-inside: avoid; } }
  </style>
</head>
<body>
  <main>
    <h1>Site Diary QR pack - ${escapeHtml(label)}</h1>
    <p>Single use sign-in codes for ${escapeHtml(project.name)}. Hand each card to the named person only. They expire, so generate a fresh pack when needed.</p>
    <div class="grid">
      ${cards.map((card) => `<section class="card">
        <img src="./${escapeHtml(card.fileName)}" alt="Sign-in QR for ${escapeHtml(card.email)}">
        <p class="role">${escapeHtml(card.role)}</p>
        <p class="name">${escapeHtml(card.name)}</p>
        <p class="email">${escapeHtml(card.email)}</p>
      </section>`).join('\n')}
    </div>
  </main>
</body>
</html>
`,
    );

    await new Promise((resolve, reject) => {
      execFile('open', [index], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    console.log(`\n  QR pack opened for ${label}: ${members.length} member${members.length === 1 ? '' : 's'}.`);
    console.log(`  Folder: ${dir}`);
    console.log('  Single use, and they expire. Generate a fresh pack when needed.\n');
    process.exit(0);
  } catch (error) {
    if (error && typeof error === 'object' && 'message' in error) {
      console.error(`Could not open the QR pack: ${error.message}`);
    }
    console.error(`\nQR pack failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
} else if (!email) {
  console.error('--email is required unless you use --project with --qr-pack.');
  process.exit(1);
}

const credential = email ? await magicCredential(email).catch((error) => {
  console.error(`Could not mint a link for ${email}: ${error.message}`);
  if (/not found/i.test(error.message)) {
    console.error('That address has no account yet.');
  }
  process.exit(1);
}) : null;
const link = credential?.link ?? null;
const token = credential?.token ?? null;

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
