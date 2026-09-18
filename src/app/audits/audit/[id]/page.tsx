import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject, guardScreen } from '@/lib/auth';
import { canAuthorEntries } from '@/lib/roles';
import { BrandMark } from '@/components/brand-mark';
import { isUuid } from '@/lib/api';
import { fmtDate } from '@/lib/pdf/dates';
import { AuditScreen } from './audit-screen';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Audit · Kooboolong IMS' };

export default async function AuditPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ project?: string }> }) {
  const { memberships } = await requireUser();
  const { id } = await params;
  const { project } = await searchParams;
  if (!isUuid(id)) notFound();
  const current = resolveProject(memberships, project);
  if (!current) redirect('/');
  guardScreen(current, 'audits');

  const supabase = await createClient();
  const { data: a } = await supabase
    .from('audits')
    .select('id, org_id, project_id, obligation_id, audit_date, scope, criteria, auditor_name, auditor_independent, previous_actions_review, summary, status, issued_on, audit_findings(id, seq, kind, clause, finding, action, owner_name, due_on, done_at, done_note)')
    .eq('id', id)
    .maybeSingle();
  if (!a || a.org_id !== current.project.org.id || (a.project_id && a.project_id !== current.project_id)) notFound();

  // Cl. 201.12.03: each audit reviews the previous audit's corrective actions. Offer what is still open.
  const { data: earlier } = await supabase
    .from('audits')
    .select('audit_date, audit_findings(seq, action, done_at)')
    .eq('org_id', a.org_id as string)
    .eq('status', 'issued')
    .lt('audit_date', a.audit_date as string)
    .order('audit_date', { ascending: false })
    .limit(1);
  const prev = (earlier ?? [])[0] as { audit_date: string; audit_findings: Array<{ seq: number; action: string | null; done_at: string | null }> } | undefined;
  const previousSummary = prev
    ? `Previous audit ${fmtDate(prev.audit_date)}: ${prev.audit_findings.filter((f) => f.action).map((f) => `finding ${f.seq} — ${f.done_at ? 'done' : 'STILL OPEN'}`).join('; ') || 'no actions raised'}.`
    : 'No earlier audit recorded.';

  return (
    <main className="sheet">
      <p className="label"><BrandMark size={18} /> {a.project_id ? current.project.name : current.project.org.name}</p>
      <h1 className="page-title">Internal audit {fmtDate(a.audit_date as string)}</h1>
      <p className="page-subtitle">{a.scope as string}</p>
      <AuditScreen
        audit={{
          id: a.id as string, date: a.audit_date as string, scope: a.scope as string, criteria: a.criteria as string, auditor: a.auditor_name as string,
          independent: Boolean(a.auditor_independent), previousReview: (a.previous_actions_review as string | null) ?? '', summary: (a.summary as string | null) ?? '',
          status: a.status as 'draft' | 'issued', issuedOn: (a.issued_on as string | null) ?? null, onSchedule: Boolean(a.obligation_id),
        }}
        findings={((a.audit_findings ?? []) as Array<{ id: string; seq: number; kind: string; clause: string | null; finding: string; action: string | null; owner_name: string | null; due_on: string | null; done_at: string | null; done_note: string | null }>).sort((x, y) => x.seq - y.seq)}
        previousSummary={previousSummary}
        canWrite={a.project_id ? canAuthorEntries(current.role) : current.role === 'admin'}
      />
      <hr className="rule" />
      <Link className="button button--quiet" href={`/audits?project=${current.project_id}`}>Back to audits and reviews</Link>
    </main>
  );
}
