import { createAdminClient } from '@/lib/supabase/admin';
import { perthToday } from '@/lib/push/decide';

/**
 * The nightly asset sweep (README R186), `?assets=1` on the ops check: every active profile on an in-service asset
 * whose next due is within the week or past, or whose meter has reached the due reading, raises its action —
 * one per profile and due day, however many nights this runs (`raise_asset_actions`, service role only). The
 * action then lives in the register (origin `asset`): the action reminder pushes its assignee, the record that
 * discharges it closes it. Nothing here stores a next due.
 */
export async function assetSweep(today = perthToday()): Promise<Record<string, unknown>> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('raise_asset_actions', { p_today: today, p_within: 7 });
  if (error) return { error: error.message };
  return { raised: Number(data ?? 0) };
}
