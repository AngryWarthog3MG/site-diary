import { redirect } from 'next/navigation';
import { requireUser, resolveProject, canRunTalks } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { Suspense } from 'react';
import { NewPrestartForm } from './new-prestart-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'New prestart · KBS Daily Diary' };

export default async function NewPrestartPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; local?: string }>;
}) {
  const { memberships, profile } = await requireUser();
  const { project, local } = await searchParams;
  const current = resolveProject(memberships, project);
  if (!current) redirect('/');
  if (!canRunTalks(current.role)) redirect(`/prestart?project=${current.project_id}`);

  // The crew list rides in the page so the sign-on chips work when this page
  // is opened from the cache with no signal.
  const supabase = await createClient();
  const { data: crewRows } = await supabase.from('crew').select('name').eq('project_id', current.project_id).eq('active', true).order('sort_order').order('name');

  return (
    <Suspense fallback={null}>
    <NewPrestartForm
      projectId={current.project_id}
      projectName={current.project.name}
      defaultSupervisor={profile?.full_name ?? ''}
      crew={(crewRows ?? []).map((c) => c.name as string)}
      localId={local ?? null}
    />
    </Suspense>
  );
}
