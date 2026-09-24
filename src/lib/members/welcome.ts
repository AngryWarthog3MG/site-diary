import { ROLE_LABEL } from '@/lib/roles';
import type { MemberRole } from '@/types/database';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

/**
 * The note a person gets when an admin adds them to a job (README R102): the
 * address of the app and the one thing to do there — type this email, tap the
 * link. Sent through the same Resend account as the safety reports, from the
 * same address. Never fatal: the membership is already written when this runs,
 * and the login screen works without it. Returns whether it went.
 */
export async function sendWelcome(input: { email: string; name: string | null; role: MemberRole; projectName: string; addedBy: string | null }): Promise<boolean> {
  const key = process.env.SMTP_PASS?.trim();
  if (!key) return false;
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://kbsdailydiary.me';
  const title = ROLE_LABEL[input.role];
  const send = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    signal: AbortSignal.timeout(15_000),
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: `Kooboolong IMS <${process.env.SMTP_SENDER ?? 'diary@kbsdailydiary.me'}>`,
      to: [input.email],
      subject: `You are on ${input.projectName} — Kooboolong IMS`,
      html:
        `<div style="font-family:Arial,sans-serif;max-width:560px;font-size:16px;line-height:1.5">` +
        `<p>${input.name ? `Hi ${esc(input.name)},` : 'Hi,'}</p>` +
        `<p>${input.addedBy ? `${esc(input.addedBy)} has put you` : 'You are'} on <b>${esc(input.projectName)}</b> as <b>${esc(title)}</b> in Kooboolong IMS.</p>` +
        `<p>To sign in on your phone:</p>` +
        `<ol style="padding-left:1.2em"><li>Open <a href="${esc(site)}/login">${esc(site.replace(/^https?:\/\//, ''))}</a></li>` +
        `<li>Type this email address: <b>${esc(input.email)}</b></li>` +
        `<li>Tap the link that comes back.</li></ol>` +
        `<p>No password, nothing to set up. Add it to your home screen once you are in, so it opens like an app.</p>` +
        `</div>`,
    }),
  }).catch(() => null);
  return Boolean(send && send.ok);
}
