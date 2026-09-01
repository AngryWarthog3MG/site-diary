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
    .select('role')
    .eq('project_id', entry.project_id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!membership || (membership.role !== 'supervisor' && membership.role !== 'admin')) {
    return fail('forbidden', 'Only a supervisor or admin on this project can record a correction.', 403);
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

  // The unique (project, date, author) key: if the caller already has their
  // own unrelated entry on this date, a correction under their name cannot
  // coexist with it.
  const { data: clash } = await supabase
    .from('entries')
    .select('id, status')
    .eq('project_id', entry.project_id)
    .eq('entry_date', entry.entry_date)
    .eq('author_id', user.id)
    .maybeSingle();
  if (clash) {
    return fail(
      'bad_request',
      'You already have an entry of your own on this date, so the correction needs to come from another supervisor or admin.',
      409,
    );
  }

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
  const [labour, plant, workItems, variations, delays, pours, quantities, dayworks, photos, sections] =
    await Promise.all([
      supabase.from('labour').select('person_name, role, area, hours, overtime_hours, source_quote, confidence').eq('entry_id', entry.id),
      supabase.from('plant').select('item, hire_type, hours, idle_hours, supplier, source_quote, confidence').eq('entry_id', entry.id),
      supabase.from('work_items').select('area, description, percent_complete, source_quote, confidence').eq('entry_id', entry.id),
      supabase.from('variations').select('description, directed_by, directed_at, vr_ref, estimated_cost, photo_urls, source_quote, confidence').eq('entry_id', entry.id),
      supabase.from('delays').select('start_time, end_time, duration_mins, cause, personnel_affected, category, source_quote, confidence').eq('entry_id', entry.id),
      supabase.from('pours').select('location, volume_m3, mix_spec, supplier, docket_nos, start_time, finish_time, docket_photo_urls, source_quote, confidence').eq('entry_id', entry.id),
      supabase.from('quantities').select('item_type, area, quantity, unit, source_quote, confidence').eq('entry_id', entry.id),
      supabase.from('dayworks').select('description, labour, plant, materials, hours, docket_ref, photo_urls, source_quote, confidence').eq('entry_id', entry.id),
      supabase.from('photos').select('url, caption, category, taken_at, lat, lng').eq('entry_id', entry.id),
      supabase.from('entry_sections').select('section, state, note').eq('entry_id', entry.id),
    ]);

  const { data: weatherRow } = await supabase
    .from('weather')
    .select('observed_impact, source')
    .eq('entry_id', entry.id)
    .maybeSingle();

  const payload = {
    labour: labour.data ?? [],
    plant: plant.data ?? [],
    work_items: workItems.data ?? [],
    variations: variations.data ?? [],
    delays: delays.data ?? [],
    pours: pours.data ?? [],
    quantities: quantities.data ?? [],
    dayworks: dayworks.data ?? [],
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
