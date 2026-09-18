import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject, guardScreen } from '@/lib/auth';
import { canAuthorEntries } from '@/lib/roles';
import { BrandMark } from '@/components/brand-mark';
import { perthToday } from '@/lib/push/decide';
import { isUuid } from '@/lib/api';
import type { ObligationKind } from '@/lib/obligations/model';
import { ScheduleScreen } from './schedule-screen';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Schedule · Kooboolong IMS' };

/**
 * One schedule: when the next occurrence is due, and every past occurrence
 * with the day it was due, the day it was done, and what shows it happened.
 * That history is what an auditor reads.
 */
export default async function SchedulePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ project?: string }>;
}) {
  const { memberships, userId } = await requireUser();
  const { id } = await params;
  const { project } = await searchParams;
  if (!isUuid(id)) notFound();
  const current = resolveProject(memberships, project);
  if (!current) redirect('/');
  guardScreen(current, 'obligations');

  const supabase = await createClient();
  const { data } = await supabase
    .from('obligations')
    .select('id, org_id, project_id, kind, title, basis, interval_months, first_due_on, active, created_at, obligation_completions(id, due_on, done_on, evidence_note, evidence_ref, created_at, done_by)')
    .eq('id', id)
    .maybeSingle();
  // RLS has already refused another company's or a labourer's; a row from another job of
  // this company is refused here, so the address cannot open a schedule the page did not list.
  if (!data || (data.project_id && data.project_id !== current.project_id) || data.org_id !== current.project.org.id) notFound();

  const completions = (data.obligation_completions ?? []) as Array<{ id: string; due_on: string; done_on: string; evidence_note: string; evidence_ref: string | null; created_at: string; done_by: string | null }>;
  const doneBy = [...new Set(completions.map((c) => c.done_by).filter((x): x is string => Boolean(x)))];
  const { data: people } = doneBy.length ? await supabase.from('profiles').select('id, full_name, email').in('id', doneBy) : { data: [] };
  const names = Object.fromEntries((people ?? []).map((p) => [p.id as string, (p.full_name as string | null) ?? (p.email as string | null) ?? 'Someone']));

  const manageable = data.project_id ? canAuthorEntries(current.role) : current.role === 'admin';

  return (
    <main className="sheet">
      <p className="label"><BrandMark size={18} /> {data.project_id ? current.project.name : current.project.org.name}</p>
      <h1 className="page-title">{data.title as string}</h1>
      {data.basis && <p className="page-subtitle">{data.basis as string}</p>}
      <ScheduleScreen
        obligation={{
          id: data.id as string,
          kind: data.kind as ObligationKind,
          intervalMonths: (data.interval_months as number | null) ?? null,
          firstDueOn: data.first_due_on as string,
          active: data.active as boolean,
          companyWide: data.project_id == null,
        }}
        completions={completions.map((c) => ({ ...c, doneByName: c.done_by ? names[c.done_by] ?? 'Someone' : null }))}
        today={perthToday()}
        canManage={manageable}
        userId={userId}
      />
      <hr className="rule" />
      <Link className="button button--quiet" href={`/due?project=${current.project_id}`}>Back to what&rsquo;s due</Link>
    </main>
  );
}
