import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject, guardScreen } from '@/lib/auth';
import { BrandMark } from '@/components/brand-mark';
import type { SetupItem } from '@/lib/setup/model';
import type { TemplateModule } from '@/app/templates/templates-screen';
import { CloseoutScreen } from './closeout-screen';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Closeout review · Kooboolong IMS' };

/**
 * The closeout loop (README R93): every item this job added by hand or read
 * from its contract, decided once — promoted into the company's templates,
 * reworded generically, or left as a one-off. Office only.
 */
export default async function CloseoutPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { memberships } = await requireUser();
  const { project } = await searchParams;
  const current = resolveProject(memberships, project);
  if (!current) redirect('/');
  guardScreen(current, 'start_gate');

  const orgId = current.project.org.id;
  const supabase = await createClient();
  const [job, modules, items] = await Promise.all([
    supabase.from('projects').select('principal_contractor').eq('id', current.project_id).single(),
    supabase.from('template_modules').select('key, name, description, sort, active').eq('org_id', orgId).eq('active', true).order('sort'),
    supabase.from('project_setup_items').select('*').eq('project_id', current.project_id).in('origin', ['manual', 'contract']),
  ]);
  const rows = ((items.data ?? []) as SetupItem[]).map((r) => ({ ...r, par_level: r.par_level == null ? null : Number(r.par_level) }));

  return (
    <main className="sheet sheet--wide">
      <p className="label"><BrandMark size={18} /> {current.project.name} · {current.project.code}</p>
      <h1 className="page-title">Closeout review</h1>
      <p className="page-subtitle">
        What this job added itself — by hand, or read from its contract — that the company&rsquo;s templates never had.
        Decide each one: promote it into a module, reworded so it names no client and no site, or leave it as a one-off.
        A promoted item reaches every job set up after this; it is never stamped back onto this one.
        {' '}<Link href={`/start-gate?project=${current.project_id}`}>Back to the start gate</Link>
      </p>
      <CloseoutScreen
        projectId={current.project_id}
        names={{ headContractor: (job.data?.principal_contractor as string | null) ?? null, projectName: current.project.name }}
        modules={(modules.data ?? []) as TemplateModule[]}
        items={rows}
      />
    </main>
  );
}
