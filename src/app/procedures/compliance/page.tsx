import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireUser, resolveProject, guardScreen } from '@/lib/auth';
import { canAuthorEntries, ROLE_LABEL } from '@/lib/roles';
import type { MemberRole } from '@/types/database';
import { BrandMark } from '@/components/brand-mark';
import { fmtDate } from '@/lib/pdf/dates';
import { perthToday } from '@/lib/push/decide';
import { complianceSummary, dueState, type AssignmentStatus } from '@/lib/documents-control/model';
import { RemindAll } from './remind-all';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Compliance overview · Kooboolong IMS' };

interface A { id: string; version_id: string; user_id: string; status: AssignmentStatus; due_on: string; reminder_count: number; version: { id: string; version: number; status: string; document: { id: string; title: string; doc_number: string | null } } }

/**
 * Where the company stands on its documents (README R120): the one figure,
 * the overdue, each document, and each person still to sign — read from the
 * assignments, never typed. Managers.
 */
export default async function CompliancePage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { memberships } = await requireUser();
  const { project } = await searchParams;
  const current = resolveProject(memberships, project);
  if (!current) redirect('/');
  guardScreen(current, 'procedures');
  if (!canAuthorEntries(current.role)) redirect(`/procedures?project=${current.project_id}`);
  const supabase = await createClient();
  const today = perthToday();
  const org = current.project.org;
  const { data, error } = await supabase
    .from('document_assignments')
    .select('id, version_id, user_id, status, due_on, reminder_count, version:document_versions!inner(id, version, status, document:controlled_documents!inner(id, title, doc_number, org_id, active))')
    .eq('version.document.org_id', org.id)
    .eq('version.document.active', true)
    .eq('version.status', 'current');
  if (error) throw new Error(`Could not read the assignments: ${error.message}`);
  const rows = (data ?? []) as unknown as A[];
  const overall = complianceSummary(rows, today);

  const byDoc = new Map<string, { title: string; number: string | null; version: number; versionId: string; rows: A[] }>();
  for (const r of rows) {
    const d = r.version.document;
    const e = byDoc.get(d.id) ?? { title: d.title, number: d.doc_number, version: r.version.version, versionId: r.version.id, rows: [] };
    e.rows.push(r); byDoc.set(d.id, e);
  }
  const docs = [...byDoc.entries()].map(([id, d]) => ({ id, ...d, summary: complianceSummary(d.rows, today) })).sort((a, b) => b.summary.overdue - a.summary.overdue || a.title.localeCompare(b.title));

  const outstanding = rows.filter((r) => r.status === 'pending');
  const ids = [...new Set(outstanding.map((r) => r.user_id))];
  const people = new Map<string, { name: string; roles: string[]; jobs: string[]; pending: number; overdue: number }>();
  if (ids.length > 0) {
    const admin = createAdminClient();
    const [{ data: profiles }, { data: members }] = await Promise.all([
      admin.from('profiles').select('id, full_name, email').in('id', ids),
      admin.from('project_members').select('user_id, role, project:projects!inner(code, org_id)').in('user_id', ids).eq('project.org_id', org.id),
    ]);
    for (const p of profiles ?? []) people.set(p.id as string, { name: (p.full_name as string | null) ?? (p.email as string | null) ?? 'Unnamed', roles: [], jobs: [], pending: 0, overdue: 0 });
    for (const m of members ?? []) {
      const pr = people.get(m.user_id as string); if (!pr) continue;
      const role = ROLE_LABEL[m.role as MemberRole] ?? String(m.role); if (!pr.roles.includes(role)) pr.roles.push(role);
      const job = (Array.isArray(m.project) ? m.project[0] : m.project) as { code: string }; if (job?.code && !pr.jobs.includes(job.code)) pr.jobs.push(job.code);
    }
    for (const r of outstanding) { const pr = people.get(r.user_id); if (!pr) continue; pr.pending += 1; if (dueState(r, today) === 'overdue') pr.overdue += 1; }
  }
  const peopleRows = [...people.entries()].map(([id, p]) => ({ id, ...p })).sort((a, b) => b.overdue - a.overdue || b.pending - a.pending || a.name.localeCompare(b.name));
  const q = `?project=${current.project_id}`;

  return (
    <main className="sheet">
      <p className="label"><BrandMark size={18} /> {org.name}</p>
      <h1 className="page-title">Compliance overview</h1>
      <p className="page-subtitle">Who has read and signed what, read from the record as it stands this morning. Nothing on this page is typed in.</p>
      <div className="docs__tools">
        <Link className="button button--quiet" href={`/procedures${q}`}>Policies &amp; procedures</Link>
        <a className="button button--quiet" href={`/api/procedures/compliance?project=${current.project_id}`}>Download as a spreadsheet</a>
      </div>
      <hr className="rule" />
      <div className="regs__facts docs__tiles">
        <span className="regs__fact regs__fact--ok"><span className="regs__fact-label">Document sign-offs</span><span className="regs__fact-text docs__big">{overall.percent == null ? '—' : `${overall.percent}%`}</span><span className="regs__fact-sub">{overall.signed} of {overall.due} due signatures</span></span>
        <span className={`regs__fact${overall.overdue ? ' regs__fact--bad' : ''}`}><span className="regs__fact-label">Overdue</span><span className="regs__fact-text docs__big">{overall.overdue}</span><span className="regs__fact-sub">{peopleRows.filter((p) => p.overdue).length} people</span></span>
        <span className="regs__fact"><span className="regs__fact-label">Still to sign</span><span className="regs__fact-text docs__big">{overall.pending}</span><span className="regs__fact-sub">{peopleRows.length} people · {docs.filter((d) => d.summary.pending).length} documents</span></span>
        <span className="regs__fact"><span className="regs__fact-label">Documents in force</span><span className="regs__fact-text docs__big">{docs.length}</span><span className="regs__fact-sub">needing a signature</span></span>
      </div>

      <hr className="rule" />
      <p className="label">By document</p>
      {docs.length === 0 ? <p className="nil">No document needing a signature has been issued yet.</p> : (
        <table className="docs__table">
          <thead><tr><th>Document</th><th>Signed</th><th>Overdue</th><th></th></tr></thead>
          <tbody>
            {docs.map((d) => (
              <tr key={d.id}>
                <td><Link href={`/procedures/${d.id}${q}`}>{d.title}</Link><span className="caption"> · v{d.version}{d.number ? ` · ${d.number}` : ''}</span></td>
                <td><span className="docs__bar"><span style={{ width: `${d.summary.percent ?? 0}%` }} /></span> <span className="caption">{d.summary.signed} of {d.summary.due}</span></td>
                <td className={d.summary.overdue ? 'vr-missing' : undefined}>{d.summary.overdue || '—'}</td>
                <td>{d.summary.pending > 0 && <RemindAll versionId={d.versionId} count={d.summary.pending} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <hr className="rule" />
      <p className="label">People still to sign · {peopleRows.length}</p>
      {peopleRows.length === 0 ? <p className="caption">Nobody. Everything due is signed.</p> : (
        <table className="docs__table">
          <thead><tr><th>Person</th><th>Role · jobs</th><th>To sign</th><th>Overdue</th></tr></thead>
          <tbody>
            {peopleRows.map((p) => (
              <tr key={p.id}><td>{p.name}</td><td className="caption">{[p.roles.join('/'), p.jobs.join(', ')].filter(Boolean).join(' · ')}</td><td>{p.pending}</td><td className={p.overdue ? 'vr-missing' : undefined}>{p.overdue || '—'}</td></tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="caption" style={{ marginTop: '1rem' }}>As of {fmtDate(today)}. Waived and superseded assignments are not counted either way.</p>
    </main>
  );
}
