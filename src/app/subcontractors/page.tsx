import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject } from '@/lib/auth';
import { sees, canAuthorEntries } from '@/lib/roles';
import { BrandMark } from '@/components/brand-mark';
import { perthToday } from '@/lib/push/decide';
import { compliance, VERDICT_LABEL, DOC_LABEL, type DocFacts } from '@/lib/subcontractors/model';
import { AddSubcontractor } from './add-subcontractor';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Subcontractors · Kooboolong IMS' };

interface Row { id: string; name: string; trade: string | null; active: boolean; subcontractor_documents: DocFacts[]; project_subcontractors: Array<{ project_id: string }> }

export default async function SubcontractorsPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { userId, memberships } = await requireUser();
  const { project } = await searchParams;
  const current = resolveProject(memberships, project);
  if (!current) return <main className="sheet"><p className="notice gap">You are not on an active project.</p></main>;
  if (!sees(current, 'subcontractors')) redirect(`/?project=${current.project_id}`);
  const supabase = await createClient();
  const { data } = await supabase
    .from('subcontractors')
    .select('id, name, trade, active, subcontractor_documents(kind, expires_on, active), project_subcontractors(project_id)')
    .eq('org_id', current.project.org.id)
    .order('name');
  const rows = (data ?? []) as Row[];
  const today = perthToday();
  const canManage = canAuthorEntries(current.role);
  const q = `?project=${current.project_id}`;
  const onJob = rows.filter((r) => r.active && r.project_subcontractors.some((p) => p.project_id === current.project_id));
  const others = rows.filter((r) => !onJob.includes(r));
  const card = (r: Row) => {
    const c = compliance(r.subcontractor_documents ?? [], today);
    const tone = c.verdict === 'compliant' ? 'prestart-row--done' : c.verdict === 'expiring' ? '' : 'prestart-row--open';
    const detail = [...c.lapsed.map((k) => `${DOC_LABEL[k]} lapsed`), ...c.missing.map((k) => `${DOC_LABEL[k]} missing`), ...c.expiring.map((e) => `${DOC_LABEL[e.kind]} expires ${e.expires_on.slice(8, 10)}/${e.expires_on.slice(5, 7)}`)].join(' · ');
    return (
      <Link key={r.id} href={`/subcontractors/${r.id}${q}`} className={`prestart-row ${r.active ? tone : 'prestart-row--done'}`}>
        <span><strong>{r.name}</strong>{r.trade ? ` · ${r.trade}` : ''}{r.active ? '' : ' · retired'}<br /><span className={`caption${c.verdict === 'lapsed' || c.verdict === 'missing' || c.verdict === 'none_recorded' ? ' vr-missing' : ''}`}>{VERDICT_LABEL[c.verdict]}{detail ? ` — ${detail}` : ''}</span></span>
        <span>Open</span>
      </Link>
    );
  };
  return (
    <main className="sheet">
      <p className="label"><BrandMark size={18} /> {current.project.org.name}</p>
      <h1 className="page-title">Subcontractors</h1>
      <p className="page-subtitle">Each company once, with its insurances, SWMS and licences and their expiry dates. The register flags a company whose paperwork has lapsed when one of its people signs in, and the office is emailed before anything expires.</p>
      {canManage && <AddSubcontractor orgId={current.project.org.id} projectId={current.project_id} userId={userId} />}
      <hr className="rule" />
      <p className="label">On this job</p>
      {onJob.length === 0 ? <p className="nil">No subcontractors engaged on this job yet — open one and engage it.</p> : onJob.map(card)}
      {others.length > 0 && (<><p className="label" style={{ marginTop: '1rem' }}>Elsewhere in the company</p>{others.map(card)}</>)}
    </main>
  );
}
