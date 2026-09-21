import { redirect } from 'next/navigation';
import { requireUser, resolveProject } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { NewProjectForm, type ModuleChoice } from './new-project-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'New project · Kooboolong IMS' };

/** A new job for the org — admins only; the RPC enforces it again underneath. Born stamped from the templates (README R92). */
export default async function NewProjectPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const { memberships } = await requireUser();
  const { project } = await searchParams;
  const current = resolveProject(memberships, project);
  if (!current) redirect('/');
  if (current.role !== 'admin') redirect(`/?project=${current.project_id}`);

  const supabase = await createClient();
  const [modules, lib] = await Promise.all([
    supabase.from('template_modules').select('key, name, description').eq('org_id', current.project.org.id).eq('active', true).order('sort'),
    supabase.from('template_items').select('id', { count: 'exact', head: true }).eq('org_id', current.project.org.id).eq('active', true),
  ]);

  return (
    <NewProjectForm
      orgId={current.project.org.id}
      orgName={current.project.org.name}
      orgCode={current.project.org.code}
      modules={(modules.data ?? []) as ModuleChoice[]}
      libraryItems={lib.count ?? 0}
    />
  );
}
