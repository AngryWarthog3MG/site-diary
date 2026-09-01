import { fail, requireApiUser, isUuid } from '@/lib/api';
import { loadClaimsData, ClaimsLoadError } from '@/lib/claims/load';

export const runtime = 'nodejs';

/** The claims register as one flat CSV — for the claims consultant's spreadsheet. */
export async function GET(request: Request) {
  const { supabase, response } = await requireApiUser();
  if (response) return response;

  const url = new URL(request.url);
  const projectId = url.searchParams.get('project');
  if (!isUuid(projectId)) return fail('bad_request', 'Bad project id.', 400);

  const { data: project } = await supabase
    .from('projects')
    .select('id, name, code, org:organisations!inner(code)')
    .eq('id', projectId)
    .maybeSingle();
  if (!project) return fail('not_found', 'That project is not on your account.', 404);
  const orgCode = (Array.isArray(project.org) ? project.org[0] : project.org)?.code as string;

  let data;
  try {
    data = await loadClaimsData(supabase, {
      id: project.id,
      name: project.name,
      code: project.code,
      orgCode,
    });
  } catch (error) {
    if (error instanceof ClaimsLoadError) return fail('bad_request', error.message, 400);
    throw error;
  }

  const esc = (value: string | number | null): string => {
    if (value == null) return '';
    const text = String(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const line = (cells: Array<string | number | null>) => cells.map(esc).join(',');

  const lines: string[] = [
    line([`${orgCode}_${project.code} claims register`, 'signed entries only']),
    line(['type', 'date', 'entry', 'reference', 'description', 'who', 'minutes', 'hours', 'crew', 'est_cost']),
  ];
  for (const r of data.delays.rows) {
    lines.push(
      line([
        'delay',
        r.date,
        r.entry_no,
        r.category,
        r.cause,
        null,
        r.duration_mins,
        r.duration_mins == null ? null : Math.round((r.duration_mins / 60) * 100) / 100,
        r.personnel_affected,
        null,
      ]),
    );
  }
  for (const r of data.variations.rows) {
    lines.push(
      line([
        'variation',
        r.date,
        r.entry_no,
        r.vr_ref ?? 'NO VR REF',
        r.description,
        r.directed_by,
        null,
        null,
        null,
        r.estimated_cost,
      ]),
    );
  }
  for (const r of data.dayworks.rows) {
    lines.push(
      line([
        'daywork',
        r.date,
        r.entry_no,
        r.docket_ref ?? 'NO DOCKET',
        r.description,
        r.labour,
        null,
        r.hours,
        null,
        null,
      ]),
    );
  }
  lines.push(
    line([
      'totals',
      null,
      null,
      null,
      null,
      null,
      data.delays.totalMinutes,
      data.delays.totalHours,
      null,
      data.variations.totalCost,
    ]),
  );

  return new Response(lines.join('\r\n') + '\r\n', {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="claims_${project.code}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
