/**
 * Docket OCR eval — drives the shipping `readDocketImage` against synthetic
 * docket photographs rendered on the spot.
 *
 * Two cases prove the two behaviours that matter:
 *   1. A clean docket: every field comes back exactly as printed.
 *   2. A docket with a smudged number: the field comes back null, because
 *      guessing a digit is the one thing this reader must never do.
 *
 * Run: npm run docket:eval   (needs ANTHROPIC_API_KEY in .env.local)
 */
import { chromium } from 'playwright';
import { readDocketImage } from '../src/lib/docket/ocr.ts';

const CLEAN = `<!doctype html><html><body style="margin:0;background:#888;padding:40px;font-family:Arial">
<div style="width:640px;background:#fdfdf8;padding:28px;border:1px solid #999;transform:rotate(-1.2deg);box-shadow:2px 4px 12px rgba(0,0,0,.4)">
  <div style="display:flex;justify-content:space-between;border-bottom:2px solid #333;padding-bottom:8px">
    <div><div style="font-size:22px;font-weight:bold">HANSON CONCRETE</div>
    <div style="font-size:11px">Welshpool Plant · ACN 009 679 734</div></div>
    <div style="text-align:right"><div style="font-size:11px">DELIVERY DOCKET</div>
    <div style="font-size:26px;font-weight:bold;font-family:monospace">742891</div></div>
  </div>
  <table style="width:100%;font-size:13px;margin-top:12px;border-collapse:collapse">
    <tr><td style="padding:4px 0;color:#555">Date</td><td>27/08/2026</td><td style="color:#555">Truck</td><td>1QKX 118</td></tr>
    <tr><td style="padding:4px 0;color:#555">Job</td><td>Curtin Uni — Kent St</td><td style="color:#555">Order</td><td>PO-88231</td></tr>
    <tr><td style="padding:4px 0;color:#555">Product</td><td colspan="3"><b>N32 20MM 100 SLUMP</b></td></tr>
    <tr><td style="padding:4px 0;color:#555">Load qty</td><td><b style="font-size:16px">6.2 m³</b></td>
        <td style="color:#555">Progressive</td><td>18.6 m³</td></tr>
    <tr><td style="padding:4px 0;color:#555">Batch time</td><td>13:42</td><td style="color:#555">Slump</td><td>100 mm</td></tr>
  </table>
</div></body></html>`;

// Same docket, but the docket number is unreadable.
const SMUDGED = CLEAN.replace(
  '<div style="font-size:26px;font-weight:bold;font-family:monospace">742891</div>',
  '<div style="font-size:26px;font-weight:bold;font-family:monospace;color:#c9c4b8;text-shadow:0 0 7px #555, 2px 1px 6px #666;filter:blur(3.5px)">742891</div>',
);

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 760, height: 560 } });

async function shoot(html: string): Promise<string> {
  await page.setContent(html, { waitUntil: 'load' });
  const shot = await page.screenshot({ type: 'jpeg', quality: 80 });
  return Buffer.from(shot).toString('base64');
}

console.log('— clean docket —');
const clean = await readDocketImage({ data: await shoot(CLEAN), mediaType: 'image/jpeg' });
console.log(' ', JSON.stringify(clean));
check('docket number read', clean.docket_no === '742891', String(clean.docket_no));
check('load qty, not progressive total', clean.volume_m3 === 6.2, String(clean.volume_m3));
check('mix read', /n32/i.test(clean.mix_spec ?? ''), String(clean.mix_spec));
check('supplier read', /hanson/i.test(clean.supplier ?? ''), String(clean.supplier));
check('marked legible', clean.legible === true);

console.log('— smudged docket number —');
const smudged = await readDocketImage({ data: await shoot(SMUDGED), mediaType: 'image/jpeg' });
console.log(' ', JSON.stringify(smudged));
check('smudged number NOT guessed', smudged.docket_no === null, String(smudged.docket_no));
check('legible fields still read', smudged.volume_m3 === 6.2, String(smudged.volume_m3));

await browser.close();
console.log(failures === 0 ? '\nDOCKET EVAL PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
