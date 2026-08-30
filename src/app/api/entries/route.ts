import { fail, ok, readJson, requireApiUser, isDate, isUuid } from '@/lib/api';

/**
 * Find or create today's draft entry.
 *
 * Idempotent by construction: the partial unique index on
 * (project_id, entry_date, author_id) guarantees one original per supervisor
 * per day, so a phone draining a backlog of three recordings from the same
 * day converges on one entry.
 *
 * `entryDate` comes from the device, not the server — "today" on site is the
 * supervisor's local date, and a Perth knock-off at 17:30 is already tomorrow
 * in UTC.
 */
export async function POST(request: Request) {
  const { supabase, user, response } = await requireApiUser();
  if (response) return response;

  const body = await readJson(request);
  const projectId = body?.projectId;
  const entryDate = body?.entryDate;
  const asCorrection = body?.asCorrection === true;

  if (!isUuid(projectId) || !isDate(entryDate)) {
    return fail('bad_request', 'projectId (uuid) and entryDate (YYYY-MM-DD) are required.', 400);
  }

  const findExisting = async () =>
    supabase
      .from('entries')
      .select('id, status, entry_no')
      .eq('project_id', projectId)
      .eq('entry_date', entryDate)
      .eq('author_id', user.id)
      .is('supersedes_entry_id', null)
      .maybeSingle();

  const { data: existing, error: findError } = await findExisting();
  if (findError) {
    return fail('server_error', findError.message, 500);
  }

  if (existing && existing.status !== 'signed') {
    return ok({ entryId: existing.id, status: existing.status, created: false });
  }

  if (existing && !asCorrection) {
    return fail(
      'day_signed',
      `${entryDate} has already been signed as ${existing.entry_no}. A correction has to be a new entry that supersedes it.`,
      409,
      { entryId: existing.id, entryNo: existing.entry_no },
    );
  }

  // A recording made after the day was signed is a correction: a fresh entry
  // that supersedes the signed one and takes its own serial. The signed entry
  // is untouched — that is the whole model. If the day's correction is itself
  // already open as a draft, reuse it rather than stacking corrections.
  if (existing && asCorrection) {
    const { data: openCorrection } = await supabase
      .from('entries')
      .select('id, status')
      .eq('supersedes_entry_id', existing.id)
      .eq('status', 'draft')
      .maybeSingle();
    if (openCorrection) {
      return ok({ entryId: openCorrection.id, status: 'draft', created: false, correction: true });
    }

    const { data: correction, error: correctionError } = await supabase
      .from('entries')
      .insert({
        project_id: projectId,
        entry_date: entryDate,
        author_id: user.id,
        supersedes_entry_id: existing.id,
      })
      .select('id, status')
      .single();
    if (correctionError) return fail('server_error', correctionError.message, 500);
    return ok({ entryId: correction.id, status: correction.status, created: true, correction: true }, 201);
  }

  const { data: created, error: insertError } = await supabase
    .from('entries')
    .insert({ project_id: projectId, entry_date: entryDate, author_id: user.id })
    .select('id, status')
    .single();

  if (insertError) {
    // Two tabs, or two queued recordings racing. The index held; take the winner.
    if (insertError.code === '23505') {
      const { data: winner } = await findExisting();
      if (winner) {
        return ok({ entryId: winner.id, status: winner.status, created: false });
      }
    }
    // RLS rejection reads as an insert failure; say something a supervisor can act on.
    if (insertError.code === '42501') {
      return fail('forbidden', 'You are not set up to record on this project.', 403);
    }
    return fail('server_error', insertError.message, 500);
  }

  return ok({ entryId: created.id, status: created.status, created: true }, 201);
}
