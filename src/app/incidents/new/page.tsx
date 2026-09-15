import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject, canReport } from '@/lib/auth';
import { BrandMark } from '@/components/brand-mark';
import { ReportForm } from './report-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Report · KBS Daily Diary' };

export default async function NewIncidentPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { userId, memberships } = await requireUser();
  const { project } = await searchParams;
  const current = resolveProject(memberships, project);
  if (!current) redirect('/');
  if (!canReport(current.role)) redirect(`/incidents?project=${current.project_id}`);
  const supabase = await createClient();
  const [{ data: crew }, { data: plant }] = await Promise.all([
    supabase.from('crew').select('name').eq('project_id', current.project_id).eq('active', true).order('sort_order').order('name'),
    supabase.from('project_plant').select('plant:plant_register!inner(name)').eq('project_id', current.project_id),
  ]);
  const plantNames = (plant ?? []).map((p) => { const r = Array.isArray(p.plant) ? p.plant[0] : p.plant; return String((r as { name: string } | null)?.name ?? ''); }).filter(Boolean);
  return (
    <main className="sheet">
      <p className="label"><BrandMark size={18} /> {current.project.name}</p>
      <h1 className="page-title">Report a hazard or incident</h1>
      {current.role === 'labourer' ? (
        <p className="page-subtitle">Say what you saw and where. A photo helps. It saves the moment you tap Report, with or without signal.</p>
      ) : (
        <p className="page-subtitle">What happened, where, who. Photos if you can. It saves the moment you tap Report, with or without signal.</p>
      )}
      <ReportForm projectId={current.project_id} userId={userId} crew={(crew ?? []).map((c) => String(c.name))} plant={plantNames} simple={current.role === 'labourer'} />
    </main>
  );
}
