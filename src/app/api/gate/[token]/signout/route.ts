import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
const bad = (message: string, status: number) => NextResponse.json({ error: { message } }, { status });

/** The visitor signs themselves out: only a self-signed, open row on this gate's job, by its own id. */
export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  if (!/^[a-z2-9]{16,40}$/.test(token)) return bad('This gate code is not in use.', 404);
  const body = (await request.json().catch(() => null)) as { id?: unknown; at?: unknown } | null;
  const id = typeof body?.id === 'string' && /^[0-9a-f-]{36}$/.test(body.id) ? body.id : null;
  if (!id) return bad('Bad request.', 400);
  const at = typeof body?.at === 'string' && Number.isFinite(Date.parse(body.at)) ? body.at : new Date().toISOString();
  const admin = createAdminClient();
  const { data: gate } = await admin.from('gate_tokens').select('project_id').eq('token', token).eq('active', true).maybeSingle();
  if (!gate) return bad('This gate code is not in use.', 404);
  const { data, error } = await admin.from('site_signins')
    .update({ signed_out_at: new Date().toISOString(), signed_out_on_device_at: at })
    .eq('id', id).eq('project_id', gate.project_id).eq('self_signed', true).is('signed_out_at', null).select('id');
  if (error) return bad('The sign-out could not be recorded.', 500);
  if (!data || data.length === 0) return bad('That sign-in is already signed out, or was not made from this phone.', 409);
  return NextResponse.json({ ok: true });
}
