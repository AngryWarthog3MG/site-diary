import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject } from '@/lib/auth';
import { canAuthorEntries } from '@/lib/roles';
import { BrandMark } from '@/components/brand-mark';
import { competencies } from '@/lib/training/model';
import { RequirementsEditor } from './requirements-editor';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Role requirements · KBS Daily Diary' };

export default async function RequirementsPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { userId, memberships } = await requireUser();
  const { project } = await searchParams;
  const current = resolveProject(memberships, project);
  if (!current) redirect('/');
  if (!canAuthorEntries(current.role)) redirect(`/training?project=${current.project_id}`);
  const supabase = await createClient();
  const orgId = current.project.org.id;
  const [{ data: reqs }, { data: custom }, { data: crew }] = await Promise.all([
    supabase.from('competency_requirements').select('role, competency').eq('org_id', orgId),
    supabase.from('org_competencies').select('id, key, label, valid_months, active').eq('org_id', orgId).order('label'),
    supabase.from('crew').select('role, project:projects!inner(org_id)').eq('project.org_id', orgId).eq('active', true),
  ]);
  const roles = [...new Set(((crew ?? []) as Array<{ role: string | null }>).map((c) => (c.role ?? '').trim().toLowerCase().replace(/\s+/g, ' ')).filter(Boolean))].sort();
  return (
    <main className="sheet sheet--wide">
      <p className="label"><BrandMark size={18} /> {current.project.org.name}</p>
      <h1 className="page-title">What each role must hold</h1>
      <p className="page-subtitle">Roles come from the crew lists (the Role column). Tick the competencies each must hold; the matrix shows a gap wherever someone in that role does not. Add the company&rsquo;s own competencies below.</p>
      <RequirementsEditor orgId={orgId} userId={userId} roles={roles} requirements={(reqs ?? []) as Array<{ role: string; competency: string }>} competencies={competencies((custom ?? []) as Array<{ key: string; label: string; active: boolean }>)} custom={(custom ?? []) as Array<{ id: string; key: string; label: string; valid_months: number | null; active: boolean }>} />
    </main>
  );
}
