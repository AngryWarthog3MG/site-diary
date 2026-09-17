import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireUser, guardScreen } from '@/lib/auth';
import { canAuthorEntries } from '@/lib/roles';
import { BrandMark } from '@/components/brand-mark';
import { perthToday } from '@/lib/push/decide';
import { inScope } from '@/lib/environment/model';
import { EvaluationScreen, type EvalView, type ObligationView, type ResultView } from './evaluation-screen';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Evaluation of compliance · KBS Daily Diary' };

/** One evaluation of compliance (ISO 14001 cl. 9.1.2): a result against every obligation in scope, then issued and frozen. */
export default async function EvaluationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ project?: string }> }) {
  const { id } = await params;
  const { project } = await searchParams;
  const { memberships } = await requireUser();
  const supabase = await createClient();
  const { data: e } = await supabase.from('compliance_evaluations').select('id, org_id, project_id, obligation_id, evaluated_on, evaluator_name, summary, status, issued_on').eq('id', id).maybeSingle();
  if (!e) notFound();
  const membership = memberships.find((m) => (e.project_id ? m.project_id === e.project_id : m.project.org.id === e.org_id && (!project || m.project_id === project)));
  if (!membership) redirect('/');
  guardScreen(membership, 'environment');

  const [{ data: obligations }, { data: results }] = await Promise.all([
    supabase.from('env_legal_obligations').select('id, project_id, title, reference, requirement, how_applies, active').eq('org_id', e.org_id),
    supabase.from('compliance_evaluation_results').select('id, legal_obligation_id, result, evidence, action, owner_name, due_on, done_at, done_note').eq('evaluation_id', id),
  ]);
  const resultRows = (results ?? []) as ResultView[];
  const all = (obligations ?? []) as ObligationView[];
  // In scope now, plus any already answered (an obligation retired after it was answered stays on the report).
  const scoped = inScope(all, e.project_id as string | null);
  const answered = all.filter((o) => resultRows.some((r) => r.legal_obligation_id === o.id) && !scoped.includes(o));

  return (
    <main className="sheet">
      <p className="label"><BrandMark size={18} /> {membership.project.org.name}</p>
      <h1 className="page-title">Evaluation of compliance</h1>
      <p className="page-subtitle">ISO 14001 cl. 9.1.2: each obligation in the legal register, whether the {e.project_id ? 'job' : 'company'} complies, the evidence, and what is being done where it does not.</p>
      <EvaluationScreen
        evaluation={e as EvalView}
        obligations={[...scoped, ...answered]}
        allObligations={all}
        results={resultRows}
        canManage={canAuthorEntries(membership.role)}
        today={perthToday()}
      />
      <hr className="rule" />
      <Link className="button button--quiet" href={`/environment?project=${membership.project_id}#evaluations`}>Back to Environment</Link>
    </main>
  );
}
