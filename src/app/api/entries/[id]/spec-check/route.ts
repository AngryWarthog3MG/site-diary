import { fail, ok, readJson, requireApiUser, isUuid } from '@/lib/api';
import { explainModelError } from '@/lib/model-error';
import { specCheck, type SpecCheckItem } from '@/lib/documents/spec-check';

export const maxDuration = 90;

/**
 * What the job's documents require for the lines on a review screen. Read
 * only — nothing is stored; the supervisor looks, then confirms what they did.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { supabase, response } = await requireApiUser();
  if (response) return response;
  const { id: entryId } = await context.params;
  if (!isUuid(entryId)) return fail('bad_request', 'Bad entry id.', 400);

  const { data: entry } = await supabase.from('entries').select('id, project_id').eq('id', entryId).maybeSingle();
  if (!entry) return fail('not_found', 'That entry is not on any of your projects.', 404);

  const body = await readJson(request);
  const raw = Array.isArray(body?.items) ? (body.items as unknown[]) : [];
  const items: SpecCheckItem[] = [];
  for (const candidate of raw.slice(0, 30)) {
    const c = candidate as Partial<SpecCheckItem>;
    if (typeof c.key !== 'string' || typeof c.text !== 'string' || !c.text.trim()) continue;
    if (c.group !== 'work_items' && c.group !== 'pours' && c.group !== 'variations') continue;
    items.push({ key: c.key.slice(0, 80), group: c.group, text: c.text.trim().slice(0, 500), area: typeof c.area === 'string' && c.area.trim() ? c.area.trim().slice(0, 200) : null });
  }
  if (items.length === 0) return ok({ documentsSearched: 0, findings: [] });

  try {
    return ok(await specCheck(supabase, entry.project_id, items));
  } catch (error) {
    const plain = explainModelError(error);
    return fail('server_error', plain.message, plain.retryable ? 503 : 422);
  }
}
