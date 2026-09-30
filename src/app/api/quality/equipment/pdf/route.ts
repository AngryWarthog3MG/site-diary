import { fail } from '@/lib/api';
import { calibrationRegister, type EquipmentRow, type CalibrationRow } from '@/lib/registers/model';
import { registerContext, registerPdf } from '@/lib/registers/respond';
import { readIds, readScope, scopeLine } from '@/lib/registers/select';

export const maxDuration = 300;
export const runtime = 'nodejs';

/** The company's calibration register as a PDF, as of today (README R117; ISO 9001 cl. 7.1.5). */
export async function GET(request: Request) {
  const { ctx, response } = await registerContext(request, 'quality');
  if (!ctx) return response;
  const { data, error } = await ctx.supabase.from('measuring_equipment')
    .select('id, name, serial_no, kind, calibration_interval_months, active, equipment_calibrations(calibrated_on, due_on, certificate_no, calibrated_by)')
    .eq('org_id', ctx.org.id);
  if (error) return fail('server_error', `Could not read the register: ${error.message}`, 500);
  const equipment: EquipmentRow[] = ((data ?? []) as Array<Omit<EquipmentRow, 'calibrations'> & { equipment_calibrations: CalibrationRow[] | null }>)
    .map(({ equipment_calibrations, ...e }) => ({ ...e, calibrations: equipment_calibrations ?? [] }));
  // Everything, or exactly the lines chosen on the Registers screen (README R118). Equipment belongs to the company, not a job.
  const url = new URL(request.url);
  const ids = readIds(url.searchParams.get('ids'));
  const scope = readScope(null, ids);
  const shown = scope === 'selected' ? equipment.filter((e) => ids!.has(e.id.toLowerCase())) : equipment;
  return registerPdf(calibrationRegister(shown, ctx.today), ctx, { slug: 'calibration', scope: scopeLine(scope, shown.length, equipment.length, ctx.project, ctx.org.name) });
}
