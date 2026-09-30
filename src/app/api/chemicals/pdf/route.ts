import { fail } from '@/lib/api';
import { chemicalsRegister, type ChemLine } from '@/lib/registers/model';
import { registerContext, registerPdf } from '@/lib/registers/respond';
import { readIds, readScope, scopeLine } from '@/lib/registers/select';
import type { SdsFacts } from '@/lib/chemicals/model';

export const maxDuration = 300;
export const runtime = 'nodejs';

interface ProductRow {
  id: string; name: string; manufacturer: string | null; product_code: string | null; hazard_classes: string[] | null;
  dg_class: string | null; used_for: string | null; active: boolean; chemical_sds: SdsFacts[] | null;
}

/**
 * The hazardous chemicals register for one workplace, with the safety data sheet held for each, as a PDF
 * (README R117). Readable by every member of the job, the labourer included — reg. 346(3).
 */
export async function GET(request: Request) {
  const { ctx, response } = await registerContext(request, 'chemicals');
  if (!ctx) return response;
  const [{ data: products, error }, { data: links }] = await Promise.all([
    ctx.supabase.from('chemical_products')
      .select('id, name, manufacturer, product_code, hazard_classes, dg_class, used_for, active, chemical_sds(id, issued_on, version, file_path, active)')
      .eq('org_id', ctx.org.id),
    ctx.supabase.from('project_chemicals').select('product_id, location, quantity').eq('project_id', ctx.project.id).eq('active', true),
  ]);
  if (error) return fail('server_error', `Could not read the register: ${error.message}`, 500);

  const here = new Map(((links ?? []) as Array<{ product_id: string; location: string | null; quantity: string | null }>).map((l) => [l.product_id, l]));
  const line = (p: ProductRow): ChemLine => ({
    name: p.name, manufacturer: p.manufacturer, product_code: p.product_code, hazardClasses: p.hazard_classes ?? [], dgClass: p.dg_class,
    usedFor: p.used_for, location: here.get(p.id)?.location ?? null, quantity: here.get(p.id)?.quantity ?? null, sheets: p.chemical_sds ?? [],
  });
  const all = (products ?? []) as ProductRow[];
  // The workplace's register, then the rest of the company's list — or only this job's, or only the lines chosen (README R118).
  const url = new URL(request.url);
  const ids = readIds(url.searchParams.get('ids'));
  const scope = readScope(url.searchParams.get('scope'), ids);
  const keep = (p: ProductRow) => (scope === 'selected' ? ids!.has(p.id.toLowerCase()) : true);
  const onSite = all.filter((p) => here.has(p.id) && keep(p));
  // A retired product that is not on this workplace is history, not a register line.
  const elsewhere = scope === 'job' ? [] : all.filter((p) => !here.has(p.id) && p.active && keep(p));
  const total = all.filter((p) => here.has(p.id) || p.active).length;
  const doc = chemicalsRegister(onSite.map(line), elsewhere.map(line), ctx.today);
  const scopeText = scope === 'all'
    ? `${ctx.project.name} · ${ctx.org.code}_${ctx.project.code} · then the rest of ${ctx.org.name}'s list`
    : scopeLine(scope, onSite.length + elsewhere.length, total, ctx.project, ctx.org.name);
  return registerPdf(doc, ctx, { slug: 'chemicals', scope: scopeText });
}
