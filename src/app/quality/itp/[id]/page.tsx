import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject, guardScreen } from '@/lib/auth';
import { canAuthorEntries } from '@/lib/roles';
import { BrandMark } from '@/components/brand-mark';
import { isUuid } from '@/lib/api';
import { itpRef, lotRef, LOT_STATUS_LABEL, type LotStatus, type PointType } from '@/lib/quality/model';
import { ItpScreen } from './itp-screen';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'ITP · Kooboolong IMS' };

export default async function ItpPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ project?: string }> }) {
  const { memberships } = await requireUser();
  const { id } = await params;
  const { project } = await searchParams;
  if (!isUuid(id)) notFound();
  const current = resolveProject(memberships, project);
  if (!current) redirect('/');
  guardScreen(current, 'quality');

  const supabase = await createClient();
  const { data: itp } = await supabase
    .from('itps')
    .select('id, project_id, code, title, spec_reference, revision, status, supersedes_id, submitted_to_principal_on, principal_review_note, issued_at, itp_points(id, seq, activity, inspection_test, acceptance_criteria, method, frequency, responsible, reviewer, point_type, uses_calibrated_equipment, record_required)')
    .eq('id', id)
    .maybeSingle();
  if (!itp || itp.project_id !== current.project_id) notFound();

  const [{ data: lots }, { data: newer }] = await Promise.all([
    supabase.from('lots').select('id, seq, description, status').eq('itp_id', id).order('seq'),
    supabase.from('itps').select('id, revision, status').eq('supersedes_id', id).maybeSingle(),
  ]);
  const q = `?project=${current.project_id}`;

  return (
    <main className="sheet">
      <p className="label"><BrandMark size={18} /> {current.project.name}</p>
      <h1 className="page-title">{itpRef(itp.code as string, itp.revision as number)}</h1>
      <p className="page-subtitle">{itp.title as string}{itp.spec_reference ? ` · ${itp.spec_reference as string}` : ''}</p>
      <ItpScreen
        itp={{
          id: itp.id as string,
          projectId: itp.project_id as string,
          code: itp.code as string,
          title: itp.title as string,
          specReference: (itp.spec_reference as string | null) ?? null,
          revision: itp.revision as number,
          status: itp.status as 'draft' | 'issued' | 'superseded',
          submittedOn: (itp.submitted_to_principal_on as string | null) ?? null,
          reviewNote: (itp.principal_review_note as string | null) ?? null,
          issuedAt: (itp.issued_at as string | null) ?? null,
        }}
        points={((itp.itp_points ?? []) as Array<{ id: string; seq: number; activity: string; inspection_test: string; acceptance_criteria: string; method: string | null; frequency: string; responsible: string; reviewer: string | null; point_type: PointType; uses_calibrated_equipment: boolean; record_required: string | null }>).sort((a, b) => a.seq - b.seq)}
        newer={newer ? { id: newer.id as string, revision: newer.revision as number, status: newer.status as string } : null}
        canManage={canAuthorEntries(current.role)}
      />
      {(lots ?? []).length > 0 && (
        <>
          <hr className="rule" />
          <p className="label">Lots worked to this revision</p>
          <ul className="gaplist">
            {((lots ?? []) as Array<{ id: string; seq: number; description: string; status: LotStatus }>).map((l) => (
              <li key={l.id}><Link href={`/quality/lot/${l.id}${q}`}>{lotRef(l.seq)}</Link> · {l.description} · {LOT_STATUS_LABEL[l.status]}</li>
            ))}
          </ul>
        </>
      )}
      <hr className="rule" />
      <Link className="button button--quiet" href={`/quality${q}`}>Back to quality</Link>
    </main>
  );
}
