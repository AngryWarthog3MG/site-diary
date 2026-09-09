import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject, canRunTalks } from '@/lib/auth';
import { PlantCheckForm } from './plant-check-form';
import type { RegisterRow } from '../plant-register';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Plant prestart · KBS Daily Diary' };

export default async function NewPlantPrestartPage({ searchParams }: { searchParams: Promise<{ project?: string; plant?: string }> }) {
  const { memberships, profile, email } = await requireUser();
  const { project, plant } = await searchParams;
  const current = resolveProject(memberships, project);
  if (!current) redirect('/');
  if (!canRunTalks(current.role)) redirect(`/plant?project=${current.project_id}`);

  const supabase = await createClient();
  const { data: register } = await supabase
    .from('plant_register')
    .select('id, name, kind, make_model, plant_no, ownership, supplier, active')
    .eq('org_id', current.project.org.id)
    .eq('active', true)
    .order('name');

  return (
    <PlantCheckForm
      projectId={current.project_id}
      projectName={current.project.name}
      orgId={current.project.org.id}
      register={(register ?? []) as RegisterRow[]}
      preselect={plant ?? null}
      defaultOperator={profile?.full_name ?? email ?? ''}
    />
  );
}
