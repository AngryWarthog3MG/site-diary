import { fail, ok, requireApiUser, readJson } from '@/lib/api';

export const runtime = 'nodejs';

/**
 * Register or remove this browser's push subscription. Rows are RLS-owned:
 * a user manages only their own delivery addresses, and the scheduled sender
 * reads them as service_role.
 */
export async function POST(request: Request) {
  const { supabase, response } = await requireApiUser();
  if (response) return response;

  const body = await readJson(request);
  const sub = body?.subscription as
    | { endpoint?: string; keys?: { p256dh?: string; auth?: string } }
    | undefined;
  if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
    return fail('bad_request', 'A push subscription is required.', 400);
  }
  if (!/^https:\/\//.test(sub.endpoint)) {
    return fail('bad_request', 'That endpoint is not a push service.', 400);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      user_id: user?.id,
      endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
    },
    { onConflict: 'endpoint' },
  );
  if (error) return fail('server_error', `Could not save the reminder: ${error.message}`, 500);
  return ok({ subscribed: true });
}

export async function DELETE(request: Request) {
  const { supabase, response } = await requireApiUser();
  if (response) return response;

  const body = await readJson(request);
  const endpoint = typeof body?.endpoint === 'string' ? body.endpoint : null;
  if (!endpoint) return fail('bad_request', 'endpoint is required.', 400);

  const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
  if (error) return fail('server_error', `Could not remove the reminder: ${error.message}`, 500);
  return ok({ subscribed: false });
}
