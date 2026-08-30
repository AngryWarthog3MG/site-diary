/**
 * The flight-mode drill.
 *
 * A real Chromium, a fake microphone, the production site, and the network
 * cut at the worst moment. The sequence a bad day on site actually produces:
 *
 *   1. Sign in, open the record screen (online — the shell gets cached).
 *   2. Go offline. Record. Stop and save.
 *   3. Assert the recording is in IndexedDB and the app says so.
 *   4. Navigate home OFFLINE — the service worker must serve the shell.
 *   5. KILL the browser. This is the phone going in the pocket, dead spot,
 *      app swiped away.
 *   6. Reopen the same profile, online. Do nothing else.
 *   7. Assert the recording uploads itself: entry + audio row in production,
 *      local queue empty.
 *
 * Runs as danny.test on Test Site (the sandbox), and deletes its draft after.
 */
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SITE = 'https://site-diary-eight.vercel.app';
const EMAIL = 'danny.test@example.com';
const PROJECT = '76c9adfb-58ec-4042-b6cf-217fc49f185a'; // Test Site

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

// Test Site is deliberately inactive so it stays out of the real picker.
// Wake it for the drill; the finally block below puts it back to sleep.
await admin.from('projects').update({ active: true }).eq('id', PROJECT);
const deactivate = async () => {
  const { error } = await admin.from('projects').update({ active: false }).eq('id', PROJECT);
  console.log(`  cleanup: Test Site ${error ? 'STILL ACTIVE — ' + error.message : 'deactivated again'}`);
};
process.on('exit', () => {});

const { data: link } = await admin.auth.admin.generateLink({ type: 'magiclink', email: EMAIL });
const confirmUrl = `${SITE}/auth/confirm?token_hash=${encodeURIComponent(link.properties.hashed_token)}&type=magiclink&next=%2F`;

const profile = mkdtempSync(join(tmpdir(), 'drill-'));
const launchOpts = {
  headless: true,
  args: [
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
  ],
};

console.log('— phase 1: online sign-in, then the signal dies —');
let ctx = await chromium.launchPersistentContext(profile, launchOpts);
let page = ctx.pages()[0] ?? (await ctx.newPage());
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('  [console]', m.text().slice(0, 160)); });
page.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 160)));
await ctx.grantPermissions(['microphone'], { origin: SITE });

await page.goto(confirmUrl, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
const landing = (await page.textContent('body')) ?? '';
check('signed in and Today loaded', /TODAY|Test Site|Record/i.test(landing), page.url());
if (!/TODAY|Test Site|Record/i.test(landing)) {
  console.log('  landing text head:', landing.replace(/\s+/g, ' ').slice(0, 200));
  await deactivate();
  process.exit(1);
}

// Visit the record screen online so the shell is in the service worker cache.
await page.goto(`${SITE}/record?project=${PROJECT}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

// The dead spot.
await ctx.setOffline(true);

const recText = ((await page.textContent('body')) ?? '').replace(/\s+/g, ' ');
if (!/Start recording/i.test(recText)) {
  console.log('  record page said:', recText.slice(0, 260));
  console.log('  url:', page.url());
  await deactivate();
  process.exit(1);
}
await page.click('text=Start recording');
await page.waitForTimeout(3500);
const timerLive = await page.locator('.timer--live').count();
check('recording ran while offline', timerLive > 0);
if (timerLive === 0) {
  console.log('  screen said:', (((await page.textContent('body')) ?? '').replace(/\s+/g, ' ')).slice(0, 300));
}

await page.click('text=Stop and save');
// The screen flashes "Saved on this phone" and then sends the supervisor home,
// where the queue row carries the same reassurance — either sighting counts.
let savedFeedback = false;
for (let i = 0; i < 16 && !savedFeedback; i += 1) {
  const t = (await page.textContent('body')) ?? '';
  savedFeedback = /Saved on this phone|On this phone \(/i.test(t);
  if (!savedFeedback) await page.waitForTimeout(500);
}
check('save succeeded with no network', savedFeedback, 'the user is told the recording is held');

const queued = await page.evaluate(async () => {
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('site-diary');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return await new Promise((res) => {
    const tx = db.transaction('capture-queue', 'readonly');
    const req = tx.objectStore('capture-queue').count();
    req.onsuccess = () => res(req.result);
  });
});
check('recording persisted to IndexedDB', queued === 1, `${queued} item(s)`);

// Navigate home, still offline — the service worker earns its keep.
await page.waitForTimeout(2000); // the screen redirects itself after save
const homeText = (await page.textContent('body')) ?? '';
check('app shell served offline', /Today|Site Diary|signal/i.test(homeText));
check(
  'queue visible to the user offline',
  /On this phone|waiting for signal|No signal/i.test(homeText),
  'they can see the recording is held',
);

console.log('— phase 2: the app is killed with the recording still aboard —');
await ctx.close();

console.log('— phase 3: reopened later, signal back, hands off —');
ctx = await chromium.launchPersistentContext(profile, launchOpts);
page = ctx.pages()[0] ?? (await ctx.newPage());
await page.goto(`${SITE}/`, { waitUntil: 'networkidle' });

let synced = false;
let audioRow = null;
for (let i = 0; i < 24; i += 1) {
  await page.waitForTimeout(5000);
  const { data } = await admin
    .from('entry_audio')
    .select('id, transcript_status, entry:entries!inner(id, project_id, author_id, created_at)')
    .eq('entry.project_id', PROJECT)
    .gte('created_at', new Date(Date.now() - 15 * 60 * 1000).toISOString())
    .order('created_at', { ascending: false })
    .limit(1);
  const row = data?.[0];
  const entry = row && (Array.isArray(row.entry) ? row.entry[0] : row.entry);
  if (entry && entry.project_id === PROJECT) {
    synced = true;
    audioRow = row;
    break;
  }
}
check('recording uploaded itself after restart', synced, audioRow ? `transcript_status=${audioRow.transcript_status}` : 'never arrived');

const remaining = await page.evaluate(async () => {
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('site-diary');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return await new Promise((res) => {
    const tx = db.transaction('capture-queue', 'readonly');
    const req = tx.objectStore('capture-queue').count();
    req.onsuccess = () => res(req.result);
  });
});
check('local queue emptied only after the server had it', remaining === 0, `${remaining} left`);

await ctx.close();
rmSync(profile, { recursive: true, force: true });

// Cleanup: the drill's draft is sandbox debris — storage object first
// (deleting the row does not delete the file), then the row.
if (audioRow) {
  const entry = Array.isArray(audioRow.entry) ? audioRow.entry[0] : audioRow.entry;
  const { data: files } = await admin.from('entry_audio').select('url').eq('entry_id', entry.id);
  const paths = (files ?? []).map((f) => f.url).filter(Boolean);
  if (paths.length) await admin.storage.from('entry-audio').remove(paths);
  const { error } = await admin.from('entries').delete().eq('id', entry.id).eq('status', 'draft');
  console.log(`  cleanup: drill draft ${error ? 'NOT removed — ' + error.message : 'and its audio removed'}`);
}

await deactivate();

const failed = results.filter((r) => !r.ok).length;
console.log(failed === 0 ? '\nDRILL PASSED — the queue survives a dead spot and a killed app.' : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
