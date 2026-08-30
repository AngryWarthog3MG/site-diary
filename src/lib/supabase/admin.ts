import 'server-only';

import { createClient as createSupabaseClient } from '@supabase/supabase-js';

/**
 * Service-role client. Bypasses RLS, so it is only for onboarding (creating an
 * organisation and seating its first admin) and, later, server-side writes to
 * the exports bucket.
 *
 * It does NOT bypass the immutability triggers — a signed entry cannot be
 * altered through this client either. That is the point of enforcing
 * immutability in the database rather than in policy.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
  }

  return createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
