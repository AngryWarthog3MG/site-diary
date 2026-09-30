import { fail } from '@/lib/api';
import { plantRegister, type PlantRecord, type PlantRow } from '@/lib/registers/model';
import { registerContext, registerPdf } from '@/lib/registers/respond';

export const maxDuration = 300;
export const runtime = 'nodejs';

/** The company's plant register as a PDF, as of today (README R117). Returned directly; nothing stored. */
export async function GET(request: Request) {
  const { ctx, response } = await registerContext(request, 'plant');
  if (!ctx) return response;
  const [{ data: plant, error }, { data: records }, { data: links }] = await Promise.all([
    ctx.supabase.from('plant_register')
      .select('id, name, kind, make_model, plant_no, ownership, supplier, active, inspection_basis, inspection_interval_months, registration_required, registration_no, registration_expires_on')
      .eq('org_id', ctx.org.id),
    ctx.supabase.from('plant_maintenance_records')
      .select('plant_id, kind, done_on, next_due_on, outcome, performed_by_name, organisation, plant:plant_register!inner(org_id)')
      .eq('plant.org_id', ctx.org.id),
    ctx.supabase.from('project_plant').select('plant_id, active, project:projects!inner(code, org_id)').eq('active', true).eq('project.org_id', ctx.org.id),
  ]);
  if (error) return fail('server_error', `Could not read the register: ${error.message}`, 500);

  const jobs = new Map<string, string[]>();
  for (const l of links ?? []) {
    const p = (Array.isArray(l.project) ? l.project[0] : l.project) as { code: string } | null;
    if (p?.code) jobs.set(l.plant_id as string, [...(jobs.get(l.plant_id as string) ?? []), p.code]);
  }
  const doc = plantRegister((plant ?? []) as PlantRow[], ((records ?? []) as unknown) as PlantRecord[], jobs, ctx.today);
  return registerPdf(doc, ctx, { slug: 'plant', scope: `The whole company · every job · printed from ${ctx.org.code}_${ctx.project.code}` });
}
