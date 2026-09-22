import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject, guardScreen } from '@/lib/auth';
import { BrandMark } from '@/components/brand-mark';
import type { TemplateItem } from '@/lib/templates/model';
import { TemplatesScreen, type TemplateModule } from './templates-screen';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Templates · Kooboolong IMS' };

/**
 * The company's template library (README R91): what every job starts with,
 * by module and kind. Company data, office lens — a PM or admin fills it;
 * every member reads it; nothing is deleted, only retired.
 */
export default async function TemplatesPage({ searchParams }: { searchParams: Promise<{ project?: string; module?: string }> }) {
  const { memberships } = await requireUser();
  const { project, module } = await searchParams;
  const current = resolveProject(memberships, project);
  if (!current) redirect('/');
  guardScreen(current, 'templates');

  const orgId = current.project.org.id;
  const supabase = await createClient();
  const [{ data: modules }, { data: items }] = await Promise.all([
    supabase.from('template_modules').select('key, name, description, sort, active').eq('org_id', orgId).order('sort'),
    supabase
      .from('template_items')
      .select('id, module_key, kind, category, title, detail, priority, min_tier, owner_role, due_offset_days, unit, par_level, folder_no, sort, active, origin')
      .eq('org_id', orgId),
  ]);
  const mods = ((modules ?? []) as TemplateModule[]).filter((m) => m.active);
  const rows = ((items ?? []) as TemplateItem[]).map((r) => ({ ...r, par_level: r.par_level == null ? null : Number(r.par_level) }));
  const chosen = mods.some((m) => m.key === module) ? (module as string) : (mods[0]?.key ?? 'core');

  return (
    <main className="sheet sheet--wide">
      <p className="label"><BrandMark size={18} /> {current.project.org.name}</p>
      <h1 className="page-title">Templates</h1>
      <p className="page-subtitle">
        What every job of this company starts with: mobilisation items, hold points, submittals, method statements,
        consumables and their par levels, risks, expected documents and the twelve folders — by module. Core is every
        job; the rest are attached per job. Fill it here; a job set up from it inherits the lot.
      </p>
      <TemplatesScreen orgId={orgId} projectId={current.project_id} modules={mods} items={rows} chosen={chosen} />
    </main>
  );
}
