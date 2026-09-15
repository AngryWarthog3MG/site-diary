import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject } from '@/lib/auth';
import { sees, canAuthorEntries } from '@/lib/roles';
import { BrandMark } from '@/components/brand-mark';
import { perthToday } from '@/lib/push/decide';
import { compliance, type DocKind } from '@/lib/subcontractors/model';
import { SubcontractorScreen, type SubcontractorView } from './subcontractor-screen';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Subcontractor · KBS Daily Diary' };

export default async function SubcontractorPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ project?: string }> }) {
  const { id } = await params;
  const { userId, memberships } = await requireUser();
  const { project } = await searchParams;
  const current = resolveProject(memberships, project);
  if (!current) redirect('/');
  if (!sees(current, 'subcontractors')) redirect(`/?project=${current.project_id}`);
  const supabase = await createClient();
  const { data: r } = await supabase
    .from('subcontractors')
    .select('*, subcontractor_documents(id, kind, title, reference, issued_on, expires_on, file_path, notes, active, created_at), project_subcontractors(project_id, scope, engaged_from, engaged_to)')
    .eq('id', id)
    .maybeSingle();
  if (!r) notFound();
  const docs = ((r.subcontractor_documents ?? []) as SubcontractorView['documents']).slice().sort((a, b) => Number(b.active) - Number(a.active) || (a.expires_on ?? '9999').localeCompare(b.expires_on ?? '9999'));
  const engagement = ((r.project_subcontractors ?? []) as Array<{ project_id: string; scope: string | null; engaged_from: string | null; engaged_to: string | null }>).find((p) => p.project_id === current.project_id) ?? null;
  const view: SubcontractorView = {
    id: r.id, orgId: r.org_id, name: r.name, abn: r.abn, trade: r.trade, contact_name: r.contact_name, contact_phone: r.contact_phone, contact_email: r.contact_email, notes: r.notes, active: r.active,
    documents: docs, engagement, result: compliance(docs.map((d) => ({ kind: d.kind as DocKind, expires_on: d.expires_on, active: d.active })), perthToday()),
  };
  return (
    <main className="sheet">
      <p className="label"><BrandMark size={18} /> {current.project.org.name}</p>
      <SubcontractorScreen sub={view} projectId={current.project_id} projectName={current.project.name} canManage={canAuthorEntries(current.role)} userId={userId} today={perthToday()} />
    </main>
  );
}
