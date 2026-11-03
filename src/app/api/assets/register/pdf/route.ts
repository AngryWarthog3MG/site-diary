import { loadAssetRegister } from '@/lib/assets/load';
import { assetRegister } from '@/lib/registers/assets';
import { registerContext, registerPdf } from '@/lib/registers/respond';
import { readIds, readScope, scopeLine } from '@/lib/registers/select';

export const maxDuration = 300;
export const runtime = 'nodejs';

/**
 * The company's asset register as a PDF, as of today (README R186): machines and everything
 * else, each with what is due on it, its meter and who has it. Everything, this job's (what is
 * checked out onto it or on its plant list), or exactly the lines chosen. Returned, never stored.
 */
export async function GET(request: Request) {
  const { ctx, response } = await registerContext(request, 'assets');
  if (!ctx) return response;
  const data = await loadAssetRegister(ctx.supabase, ctx.org.id, ctx.today);
  const url = new URL(request.url);
  const ids = readIds(url.searchParams.get('ids'));
  const scope = readScope(url.searchParams.get('scope'), ids);
  const all = data.verdicts;
  let shown = all;
  if (scope === 'selected') shown = all.filter((v) => ids!.has(v.asset.id.toLowerCase()));
  else if (scope === 'job') {
    const { data: links } = await ctx.supabase.from('project_plant').select('plant_id').eq('project_id', ctx.project.id).eq('active', true);
    const onJob = new Set((links ?? []).map((l) => l.plant_id as string));
    shown = all.filter((v) => (v.asset.plant_id && onJob.has(v.asset.plant_id)) || v.custody?.project_code === ctx.project.code);
  }
  const doc = assetRegister(shown, ctx.today);
  return registerPdf(doc, ctx, { slug: 'assets', scope: scopeLine(scope, shown.length, all.length, ctx.project, ctx.org.name) });
}
