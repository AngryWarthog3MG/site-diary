import { createHash } from 'node:crypto';
import { fail, ok, requireApiUser, isUuid } from '@/lib/api';
import { extractEntry, ExtractionError, EXTRACTION_MODEL } from '@/lib/extraction/extract';
import { PROMPT_VERSION } from '@/lib/extraction/prompt';
import {
  applyStandardDay,
} from '@/lib/extraction/completeness';
import { applyKnownNames } from '@/lib/extraction/known-names';
import {
  followUpQuestions,
  lowConfidenceCount,
  proposalBlockingGaps,
  reconcileSections,
} from '@/lib/extraction/completeness';

// One call, but a thinking one over a full transcript.
export const maxDuration = 180;

/**
 * Run extraction over an entry's transcript and store the result as a proposal.
 *
 * This writes nothing to labour, plant, work_items, variations, delays, pours
 * or quantities. Brief non-negotiable #1 — the AI extracts, the supervisor
 * approves — so the output lands in entry_extractions and the review screen
 * (step 4) is what turns approved items into the record.
 *
 * Idempotent against the transcript: calling it again with the same words
 * returns the existing proposal rather than paying for a second opinion. Pass
 * `{ "force": true }` to re-run after a prompt change.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { supabase, user, response } = await requireApiUser();
  if (response) return response;

  const { id: entryId } = await context.params;
  if (!isUuid(entryId)) return fail('bad_request', 'Bad entry id.', 400);

  const body = await request
    .json()
    .catch(() => ({}) as Record<string, unknown>);
  const force = body?.force === true;

  const { data: entry, error: entryError } = await supabase
    .from('entries')
    .select('id, project_id, entry_date, status, author_id, transcript_raw')
    .eq('id', entryId)
    .maybeSingle();

  if (entryError) return fail('server_error', entryError.message, 500);
  if (!entry) return fail('not_found', 'That entry is not on any of your projects.', 404);
  if (entry.status === 'signed') {
    return fail('entry_signed', 'That entry is signed and cannot be re-extracted.', 409);
  }
  if (entry.author_id !== user.id) {
    return fail('forbidden', 'That entry belongs to another supervisor.', 403);
  }

  const transcript = entry.transcript_raw?.trim();
  if (!transcript) {
    return fail('bad_request', 'There is no transcript on this entry yet.', 400);
  }

  const transcriptSha = createHash('sha256').update(transcript, 'utf8').digest('hex');

  // Already extracted these exact words? Hand back what we have.
  const { data: existing } = await supabase
    .from('entry_extractions')
    .select('*')
    .eq('entry_id', entry.id)
    .eq('status', 'pending')
    .maybeSingle();

  if (
    existing &&
    !force &&
    existing.transcript_sha256 === transcriptSha &&
    existing.prompt_version === PROMPT_VERSION
  ) {
    return ok({ ...describe(existing.proposal), extractionId: existing.id, reused: true });
  }

  const { data: projectName } = await supabase
    .from('projects')
    .select('name')
    .eq('id', entry.project_id)
    .maybeSingle();

  const { data: vocabulary } = await supabase.rpc('project_keyterms', {
    p_project_id: entry.project_id,
  });

  let result;
  try {
    result = await extractEntry({
      transcript,
      entryDate: entry.entry_date,
      projectName: projectName?.name ?? null,
      vocabulary: (vocabulary as string[] | null) ?? [],
    });
  } catch (error) {
    if (error instanceof ExtractionError) {
      return fail('server_error', error.message, error.retryable ? 503 : 422);
    }
    return fail('server_error', 'Extraction failed.', 500);
  }

  // The model's own section labels are checked against what it actually
  // extracted before anything is shown to a supervisor.
  const { proposal: reconciled, corrections } = reconcileSections(result.proposal);

  // The names this job answers to: "Marcus" is Marcus Hayden, "the
  // excavator" is the 1.8t Excavator on dry hire from KBS. Stated hours with
  // no times are laid out from the standard start. Deterministic, in code,
  // before the policy fill below has its turn at anything still blank.
  const [{ data: crewRows }, { data: plantRows }] = await Promise.all([
    supabase.from('crew').select('name, role, aliases').eq('project_id', entry.project_id).eq('active', true),
    supabase.from('plant_list').select('item, hire_type, supplier, aliases').eq('project_id', entry.project_id).eq('active', true),
  ]);
  const { proposal: named } = applyKnownNames(
    reconciled,
    ((crewRows ?? []) as Array<{ name: string; role: string | null; aliases: string[] | null }>).map((c) => ({
      name: c.name, role: c.role, aliases: c.aliases ?? [],
    })),
    ((plantRows ?? []) as Array<{ item: string; hire_type: string | null; supplier: string | null; aliases: string[] | null }>).map((p) => ({
      item: p.item, hire_type: p.hire_type, supplier: p.supplier, aliases: p.aliases ?? [],
    })),
  );
  // Site policy: a person whose time nobody stated gets the standard day.
  const { proposal } = applyStandardDay(named);

  // One pending proposal at a time — a supervisor should not be choosing
  // between two versions of their own day.
  if (existing) {
    await supabase
      .from('entry_extractions')
      .update({ status: 'superseded' })
      .eq('id', existing.id);
  }

  const { data: saved, error: saveError } = await supabase
    .from('entry_extractions')
    .insert({
      entry_id: entry.id,
      status: 'pending',
      model: result.model || EXTRACTION_MODEL,
      prompt_version: result.promptVersion,
      transcript_sha256: transcriptSha,
      proposal,
      raw_response: result.raw as object,
      input_tokens: result.inputTokens,
      output_tokens: result.outputTokens,
    })
    .select('id')
    .single();

  if (saveError) return fail('server_error', saveError.message, 500);

  return ok({
    ...describe(proposal),
    extractionId: saved.id,
    reused: false,
    corrections,
  });
}

/** Everything the review screen needs alongside the items themselves. */
function describe(proposal: unknown) {
  const typed = proposal as Parameters<typeof followUpQuestions>[0];
  return {
    proposal: typed,
    followUps: followUpQuestions(typed),
    blockingGaps: proposalBlockingGaps(typed),
    lowConfidence: lowConfidenceCount(typed),
  };
}
