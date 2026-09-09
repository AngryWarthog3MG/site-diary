import { fail, requireApiUser, isUuid, isDate } from '@/lib/api';
import { canExportReports } from '@/lib/roles';
import type { MemberRole } from '@/types/database';

/**
 * The plant prestart register for a date range as a spreadsheet — what a
 * client or an inspector asks for after an incident. One row per signed
 * inspection.
 */
export async function GET(request: Request) {
  const { supabase, user, response } = await requireApiUser();
  if (response) return response;
  const url = new URL(request.url);
  const projectId = url.searchParams.get('project');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  if (!isUuid(projectId) || !isDate(from) || !isDate(to)) return fail('bad_request', 'project, from and to are required.', 400);

  const { data: membership } = await supabase.from('project_members').select('role').eq('project_id', projectId).eq('user_id', user.id).maybeSingle();
  if (!membership) return fail('not_found', 'That project is not one of yours.', 404);
  if (!canExportReports(membership.role as MemberRole)) return fail('forbidden', 'Exports are for supervisors, admins and the PM.', 403);

  const { data: rows, error } = await supabase
    .from('plant_prestarts')
    .select('prestart_date, operator_name, hour_meter, fit_for_use, checks, completed_at, plant:plant_register!inner(name, plant_no)')
    .eq('project_id', projectId)
    .gte('prestart_date', from)
    .lte('prestart_date', to)
    .not('completed_at', 'is', null)
    .order('prestart_date')
    .order('completed_at');
  if (error) return fail('server_error', error.message, 500);

  const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const awst = (iso: string) => { const d = new Date(Date.parse(iso) + 480 * 60000); const p = (n: number) => String(n).padStart(2, '0'); return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`; };
  const lines = ['Date,Plant,Plant no,Operator,Hour meter,Fit for use,Defects,Signed (AWST)'];
  for (const r of rows ?? []) {
    const plant = (Array.isArray(r.plant) ? r.plant[0] : r.plant) as { name: string; plant_no: string | null };
    const defects = Array.isArray(r.checks) ? (r.checks as Array<{ result?: string }>).filter((c) => c.result === 'defect').length : 0;
    lines.push([r.prestart_date, plant.name, plant.plant_no ?? '', r.operator_name, r.hour_meter ?? '', r.fit_for_use ? 'Yes' : 'NO', defects, awst(r.completed_at as string)].map(q).join(','));
  }
  return new Response(lines.join('\r\n') + '\r\n', {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="plant-prestarts-${from}-to-${to}.csv"` },
  });
}
