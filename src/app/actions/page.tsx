import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject, guardScreen } from '@/lib/auth';
import { canRunTalks } from '@/lib/roles';
import { BrandMark } from '@/components/brand-mark';
import { perthToday } from '@/lib/push/decide';
import { loadActionRegister } from '@/lib/actions/load';
import { Register } from './register';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Action register · Kooboolong IMS' };

/**
 * The action register (README R177): every action on this job, from whatever record, and the company-wide ones,
 * in the order they need doing — overdue first. The one place to ask "what is on me" and "what is late".
 */
export default async function ActionsPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { memberships, userId } = await requireUser();
  const { project } = await searchParams;
  const current = resolveProject(memberships, project);
  if (!current) return <main className="sheet"><p className="notice gap">You are not on an active project.</p></main>;
  guardScreen(current, 'actions');
  if (current.role === 'labourer') redirect(`/?project=${current.project_id}`);

  const supabase = await createClient();
  const today = perthToday();
  const data = await loadActionRegister(supabase, current.project_id, current.project.org.id, today, userId, { includeDone: true });

  return (
    <main className="sheet">
      <p className="label"><BrandMark size={18} /> {current.project.name}</p>
      <h1 className="page-title">Action register</h1>
      <p className="page-subtitle">
        Every action on this job in one list — from hazard reports, inspections, audits, reviews and compliance
        checks, and the ones raised by hand — overdue first. Give one to a person and their phone is told.
      </p>
      <Register
        orgId={current.project.org.id}
        projectId={current.project_id}
        userId={userId}
        today={today}
        canRaise={canRunTalks(current.role)}
        canRaiseCompany={current.role === 'pm' || current.role === 'admin'}
        rows={data.rows}
        summary={data.summary}
        people={data.people}
      />
    </main>
  );
}
