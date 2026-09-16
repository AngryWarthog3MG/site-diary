import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject, guardScreen } from '@/lib/auth';
import { canAuthorEntries } from '@/lib/roles';
import { BrandMark } from '@/components/brand-mark';
import { isUuid } from '@/lib/api';
import { lotRef, ncrRef, type Disposition, type NcrStatus } from '@/lib/quality/model';
import { NcrScreen } from './ncr-screen';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'NCR · KBS Daily Diary' };

export default async function NcrPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ project?: string }> }) {
  const { memberships } = await requireUser();
  const { id } = await params;
  const { project } = await searchParams;
  if (!isUuid(id)) notFound();
  const current = resolveProject(memberships, project);
  if (!current) redirect('/');
  guardScreen(current, 'quality');

  const supabase = await createClient();
  const { data: n } = await supabase
    .from('ncrs')
    .select('id, project_id, seq, lot_id, itp_point_id, detected_at, detected_by_name, observation, attribution, location, root_cause, corrective_action, preventive_action, disposition, disposition_detail, reported_to_principal_at, principal_response, status, approved_by_name, approved_at, closed_at, close_note')
    .eq('id', id)
    .maybeSingle();
  if (!n || n.project_id !== current.project_id) notFound();

  const [{ data: lot }, { data: point }, { data: proj }] = await Promise.all([
    n.lot_id ? supabase.from('lots').select('id, seq, description').eq('id', n.lot_id as string).maybeSingle() : Promise.resolve({ data: null }),
    n.itp_point_id ? supabase.from('itp_points').select('seq, inspection_test, acceptance_criteria').eq('id', n.itp_point_id as string).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from('projects').select('ncr_report_hours').eq('id', current.project_id).single(),
  ]);
  const q = `?project=${current.project_id}`;
  const l = lot as { id: string; seq: number; description: string } | null;
  const p = point as { seq: number; inspection_test: string; acceptance_criteria: string } | null;

  return (
    <main className="sheet">
      <p className="label"><BrandMark size={18} /> {current.project.name}</p>
      <h1 className="page-title">{ncrRef(n.seq as number)}</h1>
      <p className="page-subtitle">
        {l ? <>On <Link href={`/quality/lot/${l.id}${q}`}>{lotRef(l.seq)}</Link> · {l.description}</> : 'Not against a lot'}
        {p ? ` · point ${p.seq}, ${p.inspection_test} (accept: ${p.acceptance_criteria})` : ''}
      </p>
      <NcrScreen
        ncr={{
          id: n.id as string,
          detectedAt: n.detected_at as string,
          detectedBy: n.detected_by_name as string,
          observation: n.observation as string,
          attribution: (n.attribution as string | null) ?? '',
          location: (n.location as string | null) ?? '',
          rootCause: (n.root_cause as string | null) ?? '',
          corrective: (n.corrective_action as string | null) ?? '',
          preventive: (n.preventive_action as string | null) ?? '',
          disposition: (n.disposition as Disposition | null) ?? null,
          dispositionDetail: (n.disposition_detail as string | null) ?? '',
          reportedAt: (n.reported_to_principal_at as string | null) ?? null,
          principalResponse: (n.principal_response as string | null) ?? '',
          status: n.status as NcrStatus,
          approvedBy: (n.approved_by_name as string | null) ?? null,
          approvedAt: (n.approved_at as string | null) ?? null,
          closedAt: (n.closed_at as string | null) ?? null,
          closeNote: (n.close_note as string | null) ?? null,
        }}
        clockHours={(proj?.ncr_report_hours as number | null) ?? null}
        canManage={canAuthorEntries(current.role)}
      />
      <hr className="rule" />
      <Link className="button button--quiet" href={`/quality${q}`}>Back to quality</Link>
    </main>
  );
}
