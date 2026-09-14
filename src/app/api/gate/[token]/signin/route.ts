import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { validateGateSignIn } from '@/lib/gate/model';
import { perthToday } from '@/lib/push/decide';

export const runtime = 'nodejs';

const bad = (message: string, status: number) => NextResponse.json({ error: { message } }, { status });

/**
 * A visitor signs themselves in. No account: the gate code is the key. The
 * server validates, rate-limits per job, stores the signature, and writes
 * the row with the service role, marked self_signed. The database applies
 * the same rules as a supervisor's tap (one open per person per day,
 * induction decided, clocks stamped).
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

  // Rate limit per job: a gate sign does not sign in sixty people in ten minutes.
  const { count } = await admin.from('site_signins').select('id', { count: 'exact', head: true })
    .eq('project_id', gate.project_id).eq('self_signed', true).gte('created_at', new Date(Date.now() - 10 * 60 * 1000).toISOString());
  if ((count ?? 0) >= 60) return bad('The gate is busy — ask at the site office to be signed in.', 429);

  const id = crypto.randomUUID();
  let signaturePath: string | null = null;
  const sig = form.get('signature');
  if (sig instanceof Blob && sig.size > 0 && sig.size < 2_000_000) {
    signaturePath = `${gate.project_id}/signin/${id}/sig-${crypto.randomUUID()}.png`;
    const { error: upErr } = await admin.storage.from('entry-photos').upload(signaturePath, Buffer.from(await sig.arrayBuffer()), { contentType: 'image/png', upsert: false });
    if (upErr) signaturePath = null;
  }
  const { error } = await admin.from('site_signins').insert({
    id, project_id: gate.project_id, signin_date: perthToday(), person_name: checked.value.name, company: checked.value.company,
    person_kind: checked.value.kind, contact: checked.value.contact, self_signed: true, signature_path: signaturePath,
    rules_acknowledged_at: new Date().toISOString(), signed_in_on_device_at: at, signed_in_by: null,
  });
  if (error) {
    if (/site_signins_one_open_idx/.test(error.message)) return bad('Someone by that name is already signed in today. If that is you, you are on the register — see the supervisor to be signed out first.', 409);
    return bad('The sign-in could not be recorded. Ask at the site office.', 500);
  }
  return NextResponse.json({ id });
}
