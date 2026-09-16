import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject } from '@/lib/auth';
import { sees, canAuthorEntries } from '@/lib/roles';
import { BrandMark } from '@/components/brand-mark';
import { perthToday } from '@/lib/push/decide';
import { fmtDate } from '@/lib/pdf/dates';
import { NewAuditForm, NewReviewForm } from './audit-forms';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Audits and reviews · KBS Daily Diary' };

/**
 * Internal audits and management reviews: the reports, their findings, and the
 * actions carried forward until they are closed out. ISO 9001, 45001 and 14001
 * cl. 9.2 and 9.3; Main Roads WA Specification 201 cl. 201.12.03 and 201.13.
 * When each is due is What's due's job; this is the evidence each happened.
 */
export default async function AuditsPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { memberships } = await requireUser();
  const { project } = await searchParams;
  const current = resolveProject(memberships, project);
  if (!current) return <main className="sheet"><p className="notice gap">You are not on an active project.</p></main>;
  if (!sees(current, 'audits')) redirect(`/?project=${current.project_id}`);

  const supabase = await createClient();
  const q = `?project=${current.project_id}`;
  const org = current.project.org.id;
  const scope = `project_id.eq.${current.project_id},project_id.is.null`;
  const [{ data: audits }, { data: reviews }, { data: schedules }] = await Promise.all([
    supabase.from('audits').select('id, project_id, audit_date, scope, auditor_name, status, issued_on, audit_findings(id, kind, done_at, action)').eq('org_id', org).or(scope).order('audit_date', { ascending: false }),
    supabase.from('management_reviews').select('id, project_id, held_on, attendees, status, issued_on, review_actions(id, done_at)').eq('org_id', org).or(scope).order('held_on', { ascending: false }),
    supabase.from('obligations').select('id, project_id, kind, title').eq('org_id', org).or(scope).eq('active', true).in('kind', ['internal_audit', 'management_review']),
  ]);
  const canWrite = canAuthorEntries(current.role);
  const isAdmin = current.role === 'admin';
  const sched = (schedules ?? []) as Array<{ id: string; project_id: string | null; kind: string; title: string }>;

  return (
    <main className="sheet">
      <p className="label"><BrandMark size={18} /> {current.project.name}</p>
      <h1 className="page-title">Audits and reviews</h1>
      <p className="page-subtitle">
        Each internal audit and management review, with what was found, what was decided, and every action until it is done.
        Issuing one marks its schedule done on What&rsquo;s due.
      </p>

      <section style={{ marginTop: '1rem' }}>
        <hr className="rule" />
        <p className="label">Internal audits</p>
        {(audits ?? []).length === 0 ? <p className="nil">No audits recorded.</p> : (
          <div className="chemreg__list">
            {((audits ?? []) as Array<{ id: string; project_id: string | null; audit_date: string; scope: string; auditor_name: string; status: string; issued_on: string | null; audit_findings: Array<{ id: string; kind: string; done_at: string | null; action: string | null }> }>).map((a) => {
              const open = a.audit_findings.filter((f) => f.action && !f.done_at).length;
              return (
                <Link key={a.id} href={`/audits/audit/${a.id}${q}`} className={`prestart-row ${a.status === 'draft' || open > 0 ? '' : 'prestart-row--done'}`}>
                  <span>
                    <strong>{fmtDate(a.audit_date)}</strong> · {a.scope}{a.project_id ? '' : ' · whole company'}
                    <br /><span className="caption">{a.status === 'draft' ? 'Draft report' : `Issued ${a.issued_on ? fmtDate(a.issued_on) : ''}`} · {a.auditor_name} · {a.audit_findings.length} finding{a.audit_findings.length === 1 ? '' : 's'}{open ? ` · ${open} action${open === 1 ? '' : 's'} open` : ''}</span>
                  </span>
                  <span className="chemreg__open">Open</span>
                </Link>
              );
            })}
          </div>
        )}
        {canWrite && <NewAuditForm orgId={org} projectId={current.project_id} today={perthToday()} isAdmin={isAdmin} schedules={sched.filter((s) => s.kind === 'internal_audit')} />}
      </section>

      <section style={{ marginTop: '1.25rem' }}>
        <hr className="rule" />
        <p className="label">Management reviews</p>
        {(reviews ?? []).length === 0 ? <p className="nil">No reviews recorded.</p> : (
          <div className="chemreg__list">
            {((reviews ?? []) as Array<{ id: string; project_id: string | null; held_on: string; attendees: string; status: string; issued_on: string | null; review_actions: Array<{ id: string; done_at: string | null }> }>).map((r) => {
              const open = r.review_actions.filter((x) => !x.done_at).length;
              return (
                <Link key={r.id} href={`/audits/review/${r.id}${q}`} className={`prestart-row ${r.status === 'draft' || open > 0 ? '' : 'prestart-row--done'}`}>
                  <span>
                    <strong>{fmtDate(r.held_on)}</strong> · {r.attendees}{r.project_id ? '' : ' · whole company'}
                    <br /><span className="caption">{r.status === 'draft' ? 'Draft' : `Issued ${r.issued_on ? fmtDate(r.issued_on) : ''}`} · {r.review_actions.length} action{r.review_actions.length === 1 ? '' : 's'}{open ? `, ${open} open` : ''}</span>
                  </span>
                  <span className="chemreg__open">Open</span>
                </Link>
              );
            })}
          </div>
        )}
        {canWrite && <NewReviewForm orgId={org} projectId={current.project_id} today={perthToday()} isAdmin={isAdmin} schedules={sched.filter((s) => s.kind === 'management_review')} />}
      </section>
    </main>
  );
}
