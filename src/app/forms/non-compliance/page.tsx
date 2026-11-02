import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject, guardScreen } from '@/lib/auth';
import { canRunTalks } from '@/lib/roles';
import { BrandMark } from '@/components/brand-mark';
import { OutboxStatus } from '@/components/outbox-status';
import { Fold } from '@/components/fold';
import { perthToday } from '@/lib/push/decide';
import { loadNonCompliances, namesFor } from '@/lib/forms/load';
import { NcList } from '../nc-list';
import { toNcView } from '../nc-view';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Non-compliance register · Kooboolong IMS' };

/** Every failing answer across every form on the job (README R180): open first, then what was resolved or removed. */
export default async function NonCompliancePage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { memberships } = await requireUser();
  const { project } = await searchParams;
  const current = resolveProject(memberships, project);
  if (!current) return <main className="sheet"><p className="notice gap">You are not on an active project.</p></main>;
  guardScreen(current, 'forms');
  if (current.role === 'labourer') redirect(`/forms?project=${current.project_id}`);
  const supabase = await createClient();
  const rows = await loadNonCompliances(supabase, { projectId: current.project_id }, { includeClosed: true });
  const nameOf = await namesFor(supabase, [...rows.map((n) => n.resolved_by), ...rows.map((n) => n.assigned_to)]);
  const views = rows.map((n) => toNcView(n, nameOf));
  const open = views.filter((n) => n.status === 'open');
  const closed = views.filter((n) => n.status !== 'open');
  const q = `?project=${current.project_id}`;
  return (
    <main className="sheet">
      <p className="label"><BrandMark size={18} /> {current.project.name}</p>
      <h1 className="page-title">Non-compliance register</h1>
      <p className="page-subtitle">
        Every failing answer on every completed form, as the form recorded it. The site resolves one with a note or raises it as an
        action; the office removes one that was not a finding, with a reason. Nothing here is deleted. <Link href={`/forms${q}`}>Back to forms</Link>
      </p>
      <OutboxStatus />
      <section className="item">
        <p className="label">Open · {open.length}</p>
        <NcList projectId={current.project_id} rows={open} canAct={canRunTalks(current.role)} isOffice={current.role === 'pm' || current.role === 'admin'} today={perthToday()} showForm />
      </section>
      {closed.length > 0 && (
        <Fold label="Resolved and removed" count={closed.length}>
          <NcList projectId={current.project_id} rows={closed} canAct={false} isOffice={false} today={perthToday()} showForm />
        </Fold>
      )}
    </main>
  );
}
