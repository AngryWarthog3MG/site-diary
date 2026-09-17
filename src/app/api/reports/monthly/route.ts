import { roleOn } from '@/lib/api-role';
import { canExportReports } from '@/lib/roles';
import { fail, ok, requireApiUser, isUuid } from '@/lib/api';
import { createAdminClient } from '@/lib/supabase/admin';
import { MonthlyLoadError } from '@/lib/monthly/bundle';
import { planMonthlyBundle, buildBundlePart, type BundlePart } from '@/lib/monthly/generate';
import { BrowserUnavailableError } from '@/lib/pdf/render';

// One part is up to a couple of minutes on Vercel: downloads from storage, a cover, the merge, the upload.
export const maxDuration = 300;
export const runtime = 'nodejs';

const LINK_TTL_SECONDS = 60 * 60;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * The monthly bundle, a part per request (README R71).
 *
 *   POST ?project&month          the plan: every part, which are already built, links to those
 *   POST ?project&month&part=N   bind and store part N (or link the one already stored)
 *
 * A whole heavy month does not fit in one 300-second function, so the page
 * asks for the plan and then builds the parts one after another.
 */
export async function POST(request: Request) {
  const { supabase, user, response } = await requireApiUser();
  if (response) return response;

  const url = new URL(request.url);
  const projectId = url.searchParams.get('project');
  const month = url.searchParams.get('month');
  const partParam = url.searchParams.get('part');
  if (!isUuid(projectId)) return fail('bad_request', 'Bad project id.', 400);
  if (!month || !MONTH_RE.test(month)) return fail('bad_request', 'month must be YYYY-MM.', 400);
  const partNo = partParam == null ? null : Number(partParam);
  const wantPlan = url.searchParams.get('plan');
  if (partNo != null && (!Number.isInteger(partNo) || partNo < 1)) return fail('bad_request', 'part must be a whole number from 1.', 400);

  const { data: project } = await supabase
    .from('projects')
    .select('id, name, code, org:organisations!inner(code)')
    .eq('id', projectId)
    .maybeSingle();
  if (!project) return fail('not_found', 'That project is not on your account.', 404);
  const role = await roleOn(supabase, projectId, user.id);
  if (!role || !canExportReports(role)) return fail('forbidden', 'Your role on this job does not include exports.', 403);
  const orgCode = (Array.isArray(project.org) ? project.org[0] : project.org)?.code as string;

  const admin = createAdminClient();
  const describe = async (part: BundlePart) => {
    let link: string | null = null;
    if (part.ready) {
      const { data } = await admin.storage.from('exports').createSignedUrl(part.objectPath, LINK_TTL_SECONDS);
      link = data?.signedUrl ?? null;
    }
    return { part: part.part, of: part.of, from: part.from, to: part.to, entries: part.entryNos.length, ready: part.ready, bytes: part.bytes ?? part.estimatedBytes, url: link };
  };

  try {
    const plan = await planMonthlyBundle(supabase, { id: project.id, name: project.name, code: project.code, orgCode }, month);
    if ('empty' in plan) return fail('not_found', 'No signed entries in that month — nothing to bundle.', 404);
    if (partNo == null) {
      return ok({ entries: plan.data.entries.length, plan: plan.planKey, parts: await Promise.all(plan.parts.map(describe)) });
    }
    // The month changed (a day signed, a correction) since the page asked for the plan: the parts
    // would no longer fit together. Say so, and the page starts again from the new plan.
    if (wantPlan && wantPlan !== plan.planKey) {
      return fail('bad_request', 'The month changed while it was being bound — a day was signed or corrected. Starting again.', 409);
    }
    const built = await buildBundlePart(plan, partNo);
    const described = await describe(built);
    if (!described.url) return fail('server_error', `Part ${partNo} was stored but no link could be made.`, 500);
    return ok(described);
  } catch (error) {
    if (error instanceof MonthlyLoadError) return fail('bad_request', error.message, 400);
    if (error instanceof BrowserUnavailableError) return fail('server_error', error.message, 501);
    const message = error instanceof Error ? error.message : 'Bundling failed.';
    return fail('server_error', `Could not build the monthly bundle: ${message}`, 500);
  }
}
