import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { validateGateSignIn } from '@/lib/gate/model';
import { perthToday } from '@/lib/push/decide';

export const runtime = 'nodejs';

const bad = (message: string, status: number) => NextResponse.json({ error: { message } }, { status });
const GENERIC = 'The sign-in could not be recorded. Ask at the site office to be signed in.';
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * A visitor signs themselves in. No account: the gate code is the key. The
 * server validates, stores the signature (a real PNG, or nothing happens),
 * and writes the row through one locked function so the per-job rate limit
 * holds under a flood. Failures all read the same, so the gate does not
 * tell a stranger who is on site.
 */
export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  if (!/^[a-z2-9]{16,40}$/.test(token)) return bad('This gate code is not in use.', 404);
  const admin = createAdminClient();
  const { data: gate } = await admin.from('gate_tokens').select('id, project_id, project:projects!inner(active)').eq('token', token).eq('active', true).maybeSingle();
  const project = gate ? ((Array.isArray(gate.project) ? gate.project[0] : gate.project) as { active: boolean }) : null;
  if (!gate || !project?.active) return bad('This gate code is not in use.', 404);

  const form = await request.formData().catch(() => null);
  if (!form) return bad('Bad request.', 400);
  const checked = validateGateSignIn({
    name: form.get('name'), company: form.get('company'), kind: form.get('kind'), contact: form.get('contact'), acknowledged: form.get('acknowledged') === 'true',
  });
  if (!checked.ok) return bad(checked.reason, 400);
  const at = typeof form.get('at') === 'string' && Number.isFinite(Date.parse(String(form.get('at')))) ? String(form.get('at')) : new Date().toISOString();

  // The signature is required, and it is a PNG or it is nothing.
  const sig = form.get('signature');
  if (!(sig instanceof Blob) || sig.size < 200 || sig.size > 2_000_000) return bad('Sign with your finger before you send it.', 400);
  const bytes = Buffer.from(await sig.arrayBuffer());
  if (!PNG.every((b, i) => bytes[i] === b)) return bad('Sign with your finger before you send it.', 400);

  const id = crypto.randomUUID();
  const signaturePath = `${gate.project_id}/signin/${id}/sig-${crypto.randomUUID()}.png`;
  const { error: upErr } = await admin.storage.from('entry-photos').upload(signaturePath, bytes, { contentType: 'image/png', upsert: false });
  if (upErr) return bad(GENERIC, 500);

  const { error } = await admin.rpc('gate_signin', {
    p_id: id, p_project: gate.project_id, p_date: perthToday(), p_name: checked.value.name, p_company: checked.value.company,
    p_kind: checked.value.kind, p_contact: checked.value.contact, p_signature_path: signaturePath, p_at: at,
  });
  if (error) {
    // The signature file is ours to remove: nothing references it.
    await admin.storage.from('entry-photos').remove([signaturePath]).catch(() => undefined);
    if (/gate busy/.test(error.message)) return bad('The gate is busy — ask at the site office to be signed in.', 429);
    // A duplicate open name reads exactly like any other failure: the gate does not say who is on site.
    return bad(GENERIC, 400);
  }
  return NextResponse.json({ id });
}
