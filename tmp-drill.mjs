/**
 * Drill: the job switcher and the split menu, as Mitchell, who is on two jobs
 * under two companies once the sandbox is awake. Read-only screens only; T001
 * goes back to sleep in the finally.
 */
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
const SITE = process.env.DRILL_SITE ?? 'http://localhost:3000';
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const checks = [];
const check = (n, ok, d = '') => { checks.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); };
const { data: t001 } = await db.from('projects').select('id').eq('code', 'T001').single();
const { data: c001 } = await db.from('projects').select('id').eq('code', 'C001').single();
const { data: signedDay } = await db.from('entries').select('id').eq('project_id', c001.id).eq('status', 'signed').order('entry_date', { ascending: false }).limit(1).single();
const { data: link } = await db.auth.admin.generateLink({ type: 'magiclink', email: 'mitchell.vanzyl@gmail.com' });
let browser = null;
try {
  await db.from('projects').update({ active: true }).eq('id', t001.id);
  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await ctx.newPage();
  const cookie = async () => (await ctx.cookies()).find((c) => c.name === 'kbl-job')?.value ?? null;
  const railText = async () => (await page.locator('nav.rail').innerText()).replace(/\s+/g, ' ');
  await page.goto(`${SITE}/auth/confirm?token_hash=${encodeURIComponent(link.properties.hashed_token)}&type=magiclink&next=%2F`, { waitUntil: 'networkidle' });

  await page.goto(`${SITE}/entries?project=${c001.id}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.jobswitch__select', { timeout: 15000 });
  const options = await page.locator('.jobswitch__select option').allInnerTexts();
  check('the rail offers both jobs, naming the company because they span two', options.length === 2 && options.some((o) => /Kooboolong/.test(o)) && options.some((o) => /Site Diary/.test(o)), options.join(' | '));
  const companyHead = async () => (await page.locator('.rail__group--company .rail__head').first().innerText()).replace(/\s+/g, ' ');
  let rail = await railText();
  check('the rail says This job, then Company · Kooboolong', /This job/i.test(rail) && /Company · Kooboolong/i.test(await companyHead()));
  check('a link that names a job set the cookie', (await cookie()) === c001.id);

  await page.locator('.jobswitch__select').selectOption(t001.id);
  await page.waitForURL((u) => u.searchParams.get('project') === t001.id, { timeout: 15000 });
  await page.waitForLoadState('networkidle');
  check('switching keeps the section and moves the job', new URL(page.url()).pathname === '/entries', page.url().replace(SITE, ''));
  check('the choice is remembered', (await cookie()) === t001.id);
  let followed = false;
  try { await page.waitForFunction(() => /site diary/i.test(document.querySelector('.rail__group--company .rail__head')?.textContent ?? ''), null, { timeout: 10000 }); followed = true; } catch { /* never updated */ }
  check('the Company heading follows the job’s company', followed, await companyHead());

  await page.goto(`${SITE}/dayworks`, { waitUntil: 'networkidle' });
  const dw = await page.locator('main').innerText();
  check('a screen that names no job opens on the one you chose', /Test Site/i.test(dw), dw.split('\n').find((l) => /Test Site|Curtin/i.test(l)) ?? '');

  await page.goto(`${SITE}/entries?project=${c001.id}`, { waitUntil: 'networkidle' });
  await page.goto(`${SITE}/claims`, { waitUntil: 'networkidle' });
  check('a link naming the other job re-points every screen after it', /Curtin University/i.test(await page.locator('main').innerText()));

  await page.goto(`${SITE}/entries/${signedDay.id}/signed?project=${c001.id}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.jobswitch__select', { timeout: 15000 });
  await page.locator('.jobswitch__select').selectOption(t001.id);
  await page.waitForURL((u) => u.searchParams.get('project') === t001.id, { timeout: 15000 });
  check('switching from a day lands on the diary list, not that day on the other job', new URL(page.url()).pathname === '/entries', new URL(page.url()).pathname);

  const phone = await browser.newContext({ viewport: { width: 400, height: 900 } });
  const pp = await phone.newPage();
  await pp.goto(`${SITE}/auth/confirm?token_hash=${encodeURIComponent((await db.auth.admin.generateLink({ type: 'magiclink', email: 'mitchell.vanzyl@gmail.com' })).data.properties.hashed_token)}&type=magiclink&next=%2F`, { waitUntil: 'networkidle' });
  await pp.goto(`${SITE}/entries?project=${c001.id}`, { waitUntil: 'networkidle' });
  await pp.getByRole('button', { name: 'Menu' }).click();
  await pp.waitForSelector('#app-menu .jobswitch__select', { timeout: 15000 });
  const drawer = (await pp.locator('#app-menu').innerText()).replace(/\s+/g, ' ');
  check('the phone drawer carries the switcher and the same split', /Job/.test(drawer) && /THIS JOB/i.test(drawer) && /COMPANY · KOOBOOLONG/i.test(drawer));
  check('the drawer captions the job once and the company once', (await pp.locator('#app-menu .navscope').allInnerTexts()).length === 1);
  const heads = await pp.locator('#app-menu .navgroup > .label').allInnerTexts();
  check('Company is the last heading, after every job heading, and names the company', /Company · Kooboolong/i.test(heads[heads.length - 1]) && !heads.slice(0, -1).some((h) => /Company/i.test(h)), heads.join(' / '));
  await pp.screenshot({ path: '/tmp/kbl-drawer.png', clip: { x: 0, y: 0, width: 400, height: 900 } });
  await page.goto(`${SITE}/plant?project=${c001.id}`, { waitUntil: 'networkidle' });
  check('the fleet register names the company', /Plant register · the whole company \(Kooboolong\)/i.test(await page.locator('main').innerText()));
  await page.screenshot({ path: '/tmp/kbl-rail.png', clip: { x: 0, y: 0, width: 300, height: 900 } });
  await phone.close();
} finally {
  if (browser) await browser.close();
  await db.from('projects').update({ active: false }).eq('id', t001.id);
  console.log('T001 back to sleep');
}
console.log(`\n${checks.filter(Boolean).length}/${checks.length} checks passed`);
