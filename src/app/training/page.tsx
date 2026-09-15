import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject } from '@/lib/auth';
import { sees, canAuthorEntries } from '@/lib/roles';
import { BrandMark } from '@/components/brand-mark';
import { perthToday } from '@/lib/push/decide';
import { buildMatrix, competencies, mergePeople } from '@/lib/training/model';
import type { TicketFacts } from '@/lib/crew/tickets';
import { Matrix } from './matrix';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Training matrix · KBS Daily Diary' };

/** Who holds what, what each role needs, what is expiring — this job's crew, or the whole company. */
export default async function TrainingPage({ searchParams }: { searchParams: Promise<{ project?: string; scope?: string }> }) {
  const { userId, memberships } = await requireUser();
  const { project, scope } = await searchParams;
  const current = resolveProject(memberships, project);
  if (!current) return <main className="sheet"><p className="notice gap">You are not on an active project.</p></main>;
  if (!sees(current, 'training')) redirect(`/?project=${current.project_id}`);
  const supabase = await createClient();
  const orgId = current.project.org.id;
  const wholeCompany = scope === 'company';
  const crewQuery = supabase.from('crew').select('name, role, project:projects!inner(org_id)').eq('active', true);
  const [{ data: crew }, { data: tickets }, { data: reqs }, { data: custom }] = await Promise.all([
    wholeCompany ? crewQuery.eq('project.org_id', orgId) : crewQuery.eq('project_id', current.project_id),
    supabase.from('crew_tickets').select('person_name, ticket_type, expires_on, active, issued_on').eq('org_id', orgId),
    supabase.from('competency_requirements').select('role, competency').eq('org_id', orgId),
    supabase.from('org_competencies').select('key, label, valid_months, active').eq('org_id', orgId).order('label'),
  ]);
  const today = perthToday();
  const crewList = ((crew ?? []) as Array<{ name: string; role: string | null }>).map((c) => ({ name: c.name, role: c.role }));
  const ticketRows = ((tickets ?? []) as Array<TicketFacts & { person_name: string; issued_on: string | null }>);
  // On a job: its crew, with their tickets. Whole company: everyone with a ticket too.
  const people = mergePeople(crewList, wholeCompany ? ticketRows : ticketRows.filter((t) => crewList.some((c) => c.name.trim().toLowerCase().replace(/\s+/g, ' ') === t.person_name.trim().toLowerCase().replace(/\s+/g, ' '))));
  const comps = competencies((custom ?? []) as Array<{ key: string; label: string; valid_months: number | null; active: boolean }>);
  const { rows, columns } = buildMatrix(people, comps, (reqs ?? []) as Array<{ role: string; competency: string }>, today);
  const q = `?project=${current.project_id}`;
  const canManage = canAuthorEntries(current.role);
  const gaps = rows.reduce((n, r) => n + r.gaps.length, 0);
  const expiring = rows.reduce((n, r) => n + r.expiring.length, 0);
  return (
    <main className="sheet sheet--wide">
      <p className="label"><BrandMark size={18} /> {wholeCompany ? current.project.org.name : current.project.name}</p>
      <h1 className="page-title">Training matrix</h1>
      <p className="page-subtitle">Every person against every competency: current, expiring within 30 days, expired, or missing. A gap is a competency the person&rsquo;s role requires and they do not hold.</p>
      <div className="photo-add-pair">
        <Link className={`button ${wholeCompany ? 'button--quiet' : ''}`} href={`/training${q}`}>This job</Link>
        <Link className={`button ${wholeCompany ? '' : 'button--quiet'}`} href={`/training${q}&scope=company`}>Whole company</Link>
      </div>
      {canManage && <Link className="button button--quiet" href={`/training/requirements${q}`}>What each role must hold</Link>}
      <section className="entries-summary" aria-label="Summary" style={{ marginTop: '1rem' }}>
        <div><p className="label">People</p><p className="entries-summary__value mono">{rows.length}</p></div>
        <div><p className="label">Gaps</p><p className={`entries-summary__value mono${gaps > 0 ? ' vr-missing' : ''}`}>{gaps}</p></div>
        <div><p className="label">Expiring</p><p className="entries-summary__value mono">{expiring}</p></div>
      </section>
      {(reqs ?? []).length === 0 && canManage && <p className="notice">No role requirements set yet, so nothing shows as a gap. Set what each role must hold.</p>}
      <Matrix rows={rows} columns={columns} allCompetencies={comps} orgId={orgId} projectId={current.project_id} userId={userId} canManage={canManage} today={today} />
    </main>
  );
}
