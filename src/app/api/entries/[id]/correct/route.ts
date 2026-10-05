import { sees } from '@/lib/roles';
import type { MemberRole } from '@/types/database';
import { copyColumns, type CopiedTable } from '@/lib/review/correction-copy';
import { fail, ok, requireApiUser, isUuid } from '@/lib/api';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

/**
 * Open a correction for a signed entry — the ONLY way anything about a signed
 * day ever changes, for admins included. The signed entry is never touched:
 * a new draft is created that supersedes it, PRE-FILLED with everything the
 * signed entry recorded, so the person correcting only adds or amends what
 * was missed. Both entries stay on the record; the register and every report
 * follow the correction.
 *
 * Any supervisor or admin on the project can correct any signed entry — the
 * supervisor who forgot items may not be the person fixing it. The correction
 * carries its own author and signature: the record shows who changed what.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { supabase, user, response } = await requireApiUser();
  if (response) return response;

  const { id } = await context.params;
  if (!isUuid(id)) return fail('bad_request', 'Bad entry id.', 400);

  const { data: entry } = await supabase
    .from('entries')
    .select('id, project_id, entry_date, status, notes')
    .eq('id', id)
    .maybeSingle();
  if (!entry) return fail('not_found', 'That entry is not on any of your projects.', 404);
  if (entry.status !== 'signed') {
    return fail('bad_request', 'Only a signed entry needs a correction — this one is still a draft.', 409);
  }

  const { data: membership } = await supabase
    .from('project_members')
    .select('role, screens')
    .eq('project_id', entry.project_id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!membership || (membership.role !== 'supervisor' && membership.role !== 'admin')) {
    return fail('forbidden', 'Only a supervisor or admin on this project can record a correction.', 403);
  }
  // The role may correct; the person must also hold the Daily Diary screen on this job (README R57).
  if (!sees({ role: membership.role as MemberRole, screens: (membership.screens as string[] | null) ?? null }, 'entries')) {
    return fail('forbidden', 'Your access on this job does not include the diary.', 403);
  }

  // Corrections chain forward: if this entry is already superseded by a
  // signed correction, the newest version is the one to correct.
  const { data: superseder } = await supabase
    .from('entries')
    .select('id, status, entry_no')
    .eq('supersedes_entry_id', entry.id)
    .maybeSingle();
  if (superseder?.status === 'signed') {
    return fail(
      'bad_request',
      `This entry has already been corrected by ${superseder.entry_no}. Correct that entry instead.`,
      409,
      { entryId: superseder.id },
    );
  }
  if (superseder?.status === 'draft') {
    // An open correction already exists — continue it rather than stacking.
    return ok({ entryId: superseder.id, created: false });
  }

  // No same-date clash check: uniqueness only binds ORIGINALS
  // (entries_one_original_per_author_per_day is partial on
  // supersedes_entry_id IS NULL), so a correction can share its author and
  // date with the entry it corrects — correcting your own day is the most
  // common case of all.
  const { data: draft, error: draftError } = await supabase
    .from('entries')
    .insert({
      project_id: entry.project_id,
      entry_date: entry.entry_date,
      author_id: user.id,
      supersedes_entry_id: entry.id,
    })
    .select('id')
    .single();
  if (draftError) return fail('server_error', draftError.message, 500);

  // Prefill: everything the signed entry recorded, through the same contract
  // the review screen submits — so the draft opens as a complete docket and
  // the person only adds what was missed.
  // The column lists are in src/lib/review/correction-copy.ts, held by a test to the review contract (README R121):
  // a field left off a list here is a fact the correction silently drops.
  const copy = (table: CopiedTable) => supabase.from(table).select(copyColumns(table)).eq('entry_id', entry.id);
  const [labour, plant, workItems, variations, delays, pours, quantities, dayworks, siteEvents, photos, sections] =
    await Promise.all([
      copy('labour'), copy('plant'), copy('work_items'), copy('variations'), copy('delays'), copy('pours'),
      copy('quantities'), copy('dayworks'), copy('site_events'), copy('photos'),
      supabase.from('entry_sections').select('section, state, note').eq('entry_id', entry.id),
    ]);
  const failed = [labour, plant, workItems, variations, delays, pours, quantities, dayworks, siteEvents, photos, sections].find((r) => r.error);
  if (failed?.error) return fail('server_error', `Could not read the signed day to copy it: ${failed.error.message}`, 500);

  const { data: weatherRow } = await supabase
    .from('weather')
    .select('observed_impact, source')
    .eq('entry_id', entry.id)
    .maybeSingle();

  const payload = {
    labour: labour.data ?? [],
    plant: plant.data ?? [],
    work_items: workItems.data ?? [],
    // A correction carries the day's number forward; a signed row from before
    // numbers lived on the day has it only through the register link.
    variations: ((variations.data ?? []) as unknown as Array<Record<string, unknown> & { register_seq: number | null; variation_number: number | null }>).map(({ variation_number, ...v }) => ({
      ...v,
      register_seq: v.register_seq ?? variation_number ?? null,
    })),
    delays: delays.data ?? [],
    pours: pours.data ?? [],
    quantities: quantities.data ?? [],
    dayworks: dayworks.data ?? [],
    site_events: siteEvents.data ?? [],
    photos: photos.data ?? [],
    sections: sections.data ?? [],
    weather_impact: (weatherRow?.observed_impact as string | null) ?? null,
    notes: (entry.notes as string | null) ?? null,
  };

  const { error: applyError } = await supabase.rpc('apply_entry_review', {
    p_entry_id: draft.id,
    p_payload: payload,
  });
  if (applyError) return fail('server_error', `Prefill failed: ${applyError.message}`, 500);

  // The weather observation carries over with its provenance intact — it is
  // the same day's reading, and apply deliberately never writes BOM rows.
  const admin = createAdminClient();
  const { data: fullWeather } = await admin
    .from('weather')
    .select('source, temp_max, temp_min, rainfall_mm, wind_dir, wind_kmh, observed_impact, station_id, station_name, station_distance_km, observed_from, observed_to, fetched_at')
    .eq('entry_id', entry.id)
    .maybeSingle();
  if (fullWeather) {
    await admin
      .from('weather')
      .upsert({ entry_id: draft.id, ...fullWeather }, { onConflict: 'entry_id' });
  }

  return ok({ entryId: draft.id, created: true }, 201);
}
