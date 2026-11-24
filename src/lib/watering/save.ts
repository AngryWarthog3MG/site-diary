import type { SupabaseClient } from '@supabase/supabase-js';
import type { Method } from './model';

/**
 * One day of the watering register, saved whole (README R190): the day itself — which is what says "this day was
 * recorded", with its maximum temperature — then every line given, each on its area and day. Both are upserts on
 * their natural keys, so a replay from the phone's outbox meets its own rows and changes nothing; the database
 * stamps a line only when it really changed. Used by the screen with signal and by the outbox without.
 */
export interface WateringDayPayload {
  projectId: string;
  day: string;
  temp: number | null;
  lines: Array<{ area_id: string; method: Method | null; hours: number | null; supp_method: Method | null; supp_hours: number | null; notes: string | null }>;
}

/** A refusal the person can act on, worded for them. `42501` marks it as "not with your rights / not any more" so a queued save stops retrying and shows why. */
function refusal(error: { message: string; code?: string }): Error {
  if (/row-level security/i.test(error.message)) return Object.assign(new Error('Your role on this job does not record watering.'), { code: '42501' });
  if (/closed/i.test(error.message)) return Object.assign(new Error('That week of the watering register is closed; nothing in it changes.'), { code: '42501' });
  return Object.assign(new Error(error.message), { code: error.code });
}

export async function saveWateringDay(supabase: SupabaseClient, p: WateringDayPayload): Promise<void> {
  const { error: dayErr } = await supabase.from('watering_days').upsert({ project_id: p.projectId, day: p.day, temp_max: p.temp }, { onConflict: 'project_id,day' });
  if (dayErr) throw refusal(dayErr);
  if (!p.lines.length) return;
  const rows = p.lines.map((l) => ({ project_id: p.projectId, day: p.day, area_id: l.area_id, method: l.method, hours: l.method ? l.hours : null, supp_method: l.supp_method, supp_hours: l.supp_method ? l.supp_hours : null, notes: l.notes }));
  const { error } = await supabase.from('watering_entries').upsert(rows, { onConflict: 'area_id,day' });
  if (error) throw refusal(error);
}
