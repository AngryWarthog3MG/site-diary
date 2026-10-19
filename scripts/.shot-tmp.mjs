import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(readFileSync('.env.local','utf8').split('\n').filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^"|"$/g,'')];}));
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession:false } });
const out = process.argv[2]; const tag = process.argv[3] ?? 'before';
const { data, error } = await sb.auth.admin.generateLink({ type: 'magiclink', email: 'mitchell.vanzyl@gmail.com' });
if (error) { console.log('link failed'); process.exit(1); }
const browser = await chromium.launch(); const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
try {
  await page.goto(`https://ims-kooboolong.net/auth/confirm?token_hash=${data.properties.hashed_token}&type=magiclink&next=${encodeURIComponent('/?project=6bf1b417-b334-45dc-a6df-94c7d8df8d56')}`, { waitUntil: 'networkidle', timeout: 60000 });
  const notNow = page.getByText('Not now', { exact: true }); await notNow.first().waitFor({ timeout: 10000 }).catch(()=>{}); if (await notNow.count()) await notNow.first().click().catch(()=>{});
  await page.locator('.row-kicker').first().waitFor({ timeout: 40000 }); await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/home-phone-${tag}.png`, fullPage: true });
  console.log('ok');
} catch (e) { console.log('failed:', String(e.message).split('\n')[0]); }
await browser.close();
