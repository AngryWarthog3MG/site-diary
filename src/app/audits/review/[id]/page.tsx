import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject, guardScreen } from '@/lib/auth';
import { canAuthorEntries } from '@/lib/roles';
import { BrandMark } from '@/components/brand-mark';
import { isUuid } from '@/lib/api';
import { fmtDate } from '@/lib/pdf/dates';
import { ReviewScreen } from './review-screen';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Management review · Kooboolong IMS' };

export default async function ReviewPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ project?: string }> }) {
  const { memberships } = await requireUser();
  const { id } = await params;
  const { project } = await searchParams;
  if (!isUuid(id)) notFound();
  const current = resolveProject(memberships, project);
  if (!current) redirect('/');
  guardScreen(current, 'audits');

  const supabase = await createClient();
  const { data: r } = await supabase
    .from('management_reviews')
    .select('id, org_id, project_id, obligation_id, held_on, attendees, inputs, outputs, status, issued_on, review_actions(id, action, owner_name, due_on, done_at, done_note, created_at)')
    .eq('id', id)
    .maybeSingle();
  if (!r || r.org_id !== current.project.org.id || (r.project_id && r.project_id !== current.project_id)) notFound();

  // Cl. 201.13 / ISO 9.3.2 a: actions from earlier reviews, still open, are carried into this one.
  const { data: earlier } = await supabase
    .from('management_reviews')
    .select('id, held_on, review_actions(id, action, owner_name, due_on, done_at)')
    .eq('org_id', r.org_id as string)
    .eq('status', 'issued')
    .lt('held_on', r.held_on as string)
    .order('held_on', { ascending: false });
  const carried = ((earlier ?? []) as Array<{ id: string; held_on: string; review_actions: Array<{ id: string; action: string; owner_name: string | null; due_on: string | null; done_at: string | null }> }>)
    .flatMap((e) => e.review_actions.filter((x) => !x.done_at).map((x) => ({ ...x, fromReview: e.held_on })));

  return (
    <main className="sheet">
      <p className="label"><BrandMark size={18} /> {r.project_id ? current.project.name : current.project.org.name}</p>
      <h1 className="page-title">Management review {fmtDate(r.held_on as string)}</h1>
      <p className="page-subtitle">{r.attendees as string}</p>
      <ReviewScreen
        review={{
          id: r.id as string, attendees: r.attendees as string, inputs: r.inputs as string, outputs: r.outputs as string,
          status: r.status as 'draft' | 'issued', issuedOn: (r.issued_on as string | null) ?? null, onSchedule: Boolean(r.obligation_id),
        }}
        actions={((r.review_actions ?? []) as Array<{ id: string; action: string; owner_name: string | null; due_on: string | null; done_at: string | null; done_note: string | null; created_at: string }>).sort((a, b) => a.created_at.localeCompare(b.created_at))}
        carried={carried}
        canWrite={r.project_id ? canAuthorEntries(current.role) : current.role === 'admin'}
      />
      <hr className="rule" />
      <Link className="button button--quiet" href={`/audits?project=${current.project_id}`}>Back to audits and reviews</Link>
    </main>
  );
}
