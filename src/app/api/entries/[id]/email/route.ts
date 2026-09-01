import { fail, ok, requireApiUser, isUuid, readJson } from '@/lib/api';
import { createAdminClient } from '@/lib/supabase/admin';
import { loadDocketEntry } from '@/lib/pdf/load';
import { collectPhotos } from '@/lib/pdf/photos';
import { renderDailyPdf, BrowserUnavailableError } from '@/lib/pdf/render';

export const maxDuration = 300;
export const runtime = 'nodejs';

const EXPORTS_BUCKET = 'exports';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_RECIPIENTS = 5;

/**
 * Email a signed entry's PDF to anyone (§6: exports are shareable).
 *
 * The attachment is the STORED export — the same bytes every recipient of
 * this entry has ever received — generated on the spot only if no export
 * exists yet. Sends from the verified domain with the sender's own address
 * as reply-to, so answers go to the person, not the robot.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { supabase, user, response } = await requireApiUser();
  if (response) return response;

  const { id } = await context.params;
  if (!isUuid(id)) return fail('bad_request', 'Bad entry id.', 400);

  const body = await readJson(request);
  const recipients = String(body?.to ?? '')
    .split(/[,;\s]+/)
    .map((address) => address.trim().toLowerCase())
    .filter(Boolean);
  if (recipients.length === 0) return fail('bad_request', 'Give at least one email address.', 400);
  if (recipients.length > MAX_RECIPIENTS) {
    return fail('bad_request', `Up to ${MAX_RECIPIENTS} addresses at a time.`, 400);
  }
  const bad = recipients.find((address) => !EMAIL_RE.test(address));
  if (bad) return fail('bad_request', `"${bad}" is not a valid email address.`, 400);

  const entry = await loadDocketEntry(supabase, id);
  if (!entry) return fail('not_found', 'That entry is not on any of your projects.', 404);
  if (entry.status !== 'signed') {
    return fail('bad_request', 'Only a signed entry can be sent. Sign it first.', 409);
  }

  // The stored export is the record's document; generate it only if absent.
  const admin = createAdminClient();
  const objectPath = `${entry.project_id}/${entry.entry_no}.pdf`;
  let pdf: Buffer;
  const existing = await admin.storage.from(EXPORTS_BUCKET).download(objectPath);
  if (existing.data) {
    pdf = Buffer.from(await existing.data.arrayBuffer());
  } else {
    try {
      const rendered = await renderDailyPdf({
        entry,
        photos: await collectPhotos(supabase, entry),
      });
      pdf = Buffer.from(rendered);
      await admin.storage
        .from(EXPORTS_BUCKET)
        .upload(objectPath, pdf, { contentType: 'application/pdf', upsert: false });
    } catch (error) {
      if (error instanceof BrowserUnavailableError) return fail('server_error', error.message, 501);
      const message = error instanceof Error ? error.message : 'PDF rendering failed.';
      return fail('server_error', `Could not prepare the PDF: ${message}`, 500);
    }
  }

  const senderKey = process.env.SMTP_PASS?.trim();
  const senderAddress = process.env.SMTP_SENDER ?? 'diary@kbsdailydiary.me';
  if (!senderKey) return fail('server_error', 'Email sending is not configured.', 503);

  const subject = `Site diary ${entry.entry_no} — ${entry.project_name}, ${entry.entry_date}`;
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px">
      <p style="font-size:11px;letter-spacing:.08em;color:#1f5c33;font-weight:bold;text-transform:uppercase">${entry.org_name} — Daily site diary</p>
      <h2 style="margin:.25em 0">${entry.entry_no}</h2>
      <p style="margin:.25em 0">${entry.project_name} · ${entry.entry_date}</p>
      <p style="margin:.25em 0;color:#555">Signed by ${entry.author_name}. The signed docket is attached as a PDF.</p>
      <p style="margin:1em 0 0;font-size:11px;color:#888">This entry is immutable; its integrity can be verified against the SHA-256 content hash printed in the document. Sent from KBS Daily Diary by ${user.email ?? 'a project member'}.</p>
    </div>`;

  const send = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${senderKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: `Site Diary <${senderAddress}>`,
      to: recipients,
      reply_to: user.email ?? undefined,
      subject,
      html,
      attachments: [{ filename: `${entry.entry_no}.pdf`, content: pdf.toString('base64') }],
    }),
  });
  const result = (await send.json().catch(() => ({}))) as { id?: string; message?: string };
  if (!send.ok) {
    return fail('server_error', `The email was not sent: ${result.message ?? send.status}`, 502);
  }

  return ok({ sent: recipients, id: result.id ?? null });
}
