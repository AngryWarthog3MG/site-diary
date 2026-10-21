import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject, guardScreen } from '@/lib/auth';
import { PlantCheckForm } from '../new/plant-check-form';
import type { RegisterRow } from '../plant-register';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Check a machine · Kooboolong IMS' };

/**
 * The labourer's door to the plant prestart (README R162): the same check, in their own name and no other, on a
 * machine that is on this job. The database holds the rule — the operator must be the caller's own name, the row is
 * theirs, the ticket must cover the machine — so this page only keeps the screen honest: the name is fixed, and the
 * list is the job's machines alone (a labourer cannot put a machine on a job). Done, it goes back to Home.
 */
export default async function PlantCheckPage({ searchParams }: { searchParams: Promise<{ project?: string; plant?: string }> }) {
  const { memberships, profile, email } = await requireUser();
  const { project, plant } = await searchParams;
  const current = resolveProject(memberships, project);
  if (!current) redirect('/');
  guardScreen(current, 'plant_check');

  const supabase = await createClient();
  const { data: onJob } = await supabase.from('project_plant').select('plant_id').eq('project_id', current.project_id).eq('active', true);
  const ids = (onJob ?? []).map((r) => r.plant_id as string);
  const { data: register } = ids.length
    ? await supabase
      .from('plant_register')
      .select('id, name, kind, make_model, plant_no, ownership, supplier, active, inspection_basis, inspection_interval_months, registration_required, registration_no, registration_expires_on')
      .eq('org_id', current.project.org.id)
      .eq('active', true)
      .in('id', ids)
      .order('name')
    : { data: [] };

  return (
    <PlantCheckForm
      projectId={current.project_id}
      projectName={current.project.name}
      orgId={current.project.org.id}
      register={(register ?? []) as RegisterRow[]}
      onJob={ids}
      preselect={plant ?? null}
      defaultOperator={profile?.full_name ?? email ?? ''}
      operatorLocked
      backTo={`/?project=${current.project_id}`}
    />
  );
}
