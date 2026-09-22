import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject, guardScreen } from '@/lib/auth';
import { BrandMark } from '@/components/brand-mark';
import { perthToday } from '@/lib/push/decide';
import type { SetupItem } from '@/lib/setup/model';
import type { TemplateModule } from '@/app/templates/templates-screen';
import { MobilisationScreen } from './mobilisation-screen';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Mobilisation · Kooboolong IMS' };

/**
 * The job's setup board (README R92): what it starts with, stamped from the
 * company's templates — mobilisation items, hold points, submittals, SWMS to
 * have, consumables, risks, expected documents, folders. Office only.
 */
export default async function MobilisationPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { memberships } = await requireUser();
  const { project } = await searchParams;
  const current = resolveProject(memberships, project);
  if (!current) redirect('/');
  guardScreen(current, 'start_gate');

  const orgId = current.project.org.id;
  const supabase = await createClient();
  const [job, attached, modules, items, lib] = await Promise.all([
    supabase.from('projects').select('tier, start_on').eq('id', current.project_id).single(),
    supabase.from('project_modules').select('module_key').eq('project_id', current.project_id),
    supabase.from('template_modules').select('key, name, description, sort, active').eq('org_id', orgId).eq('active', true).order('sort'),
    supabase.from('project_setup_items').select('*').eq('project_id', current.project_id),
    supabase.from('template_items').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('active', true),
  ]);
  const rows = ((items.data ?? []) as SetupItem[]).map((r) => ({ ...r, par_level: r.par_level == null ? null : Number(r.par_level) }));
  const jobRow = (job.data ?? { tier: 'full', start_on: null }) as { tier: 'light' | 'full'; start_on: string | null };

  return (
    <main className="sheet sheet--wide">
      <p className="label"><BrandMark size={18} /> {current.project.name} · {current.project.code}</p>
      <h1 className="page-title">Mobilisation</h1>
      <p className="page-subtitle">
        What this job needs to mobilise and run, stamped from the company&rsquo;s templates: the mobilisation items, hold points,
        submittals, method statements to have, consumables and their par levels, risks, the documents expected in
        each folder. Tick things off as they land; mark what does not apply. Nothing here is deleted.
      </p>
      <MobilisationScreen
        projectId={current.project_id}
        tier={jobRow.tier}
        startOn={jobRow.start_on}
        attached={(attached.data ?? []).map((m) => m.module_key as string)}
        modules={(modules.data ?? []) as TemplateModule[]}
        items={rows}
        libraryItems={lib.count ?? 0}
        today={perthToday()}
      />
    </main>
  );
}
