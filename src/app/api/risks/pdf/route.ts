import { isUuid } from '@/lib/api';
import { loadRiskRegister } from '@/lib/risks/load';
import { riskRegister, type ProfilePrint } from '@/lib/registers/risks';
import { registerContext, registerPdf } from '@/lib/registers/respond';
import { readIds, readScope, scopeLine } from '@/lib/registers/select';

export const maxDuration = 300;
export const runtime = 'nodejs';

/**
 * The risk register as a PDF, as of today (README R187): every profile the caller may read, this
 * job's (the company's, the job's own and the assets'), exactly the profiles chosen, or one profile
 * (`profile=`). Archived profiles print only when chosen by id. Returned, never stored.
 */
export async function GET(request: Request) {
  const { ctx, response } = await registerContext(request, 'risks');
  if (!ctx) return response;
  const url = new URL(request.url);
  const profileId = url.searchParams.get('profile');
  if (profileId && !isUuid(profileId)) return new Response('Bad profile id.', { status: 400 });
  const ids = readIds(url.searchParams.get('ids'));
  const scope = profileId ? 'selected' : readScope(url.searchParams.get('scope'), ids);
  const data = await loadRiskRegister(ctx.supabase, ctx.org.id, ctx.today, profileId ? { profileId } : scope === 'job' ? { projectId: ctx.project.id } : undefined);
  const all = data.verdicts.filter((v) => v.profile.status !== 'archived' || profileId || ids?.has(v.profile.id.toLowerCase()));
  const shown = scope === 'selected' && !profileId ? all.filter((v) => ids!.has(v.profile.id.toLowerCase())) : all;
  const profiles: ProfilePrint[] = shown.map((v) => ({
    name: v.profile.name, scope: v.profile.scope, status: v.profile.status, projectCode: v.projectCode, assetName: v.assetName,
    originator_name: v.profile.originator_name, assessor_name: v.profile.assessor_name, owner_name: v.profile.owner_name,
    lastReviewedOn: v.lastReviewedOn, reviewDue: v.reviewDue, reviewStatus: v.reviewStatus,
    risks: data.risks.filter((r) => r.profile_id === v.profile.id),
    controls: data.controls.filter((c) => data.risks.some((r) => r.id === c.risk_id && r.profile_id === v.profile.id)),
  }));
  const line = profileId && shown[0] ? `One profile: ${shown[0].profile.name}` : scopeLine(scope, shown.length, data.verdicts.length, ctx.project, ctx.org.name);
  const doc = riskRegister(profiles, line);
  return registerPdf(doc, ctx, { slug: 'risks', scope: line });
}
