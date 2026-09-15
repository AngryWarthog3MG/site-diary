import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, guardScreen } from '@/lib/auth';
import { canAuthorEntries } from '@/lib/roles';
import { BrandMark } from '@/components/brand-mark';
import { perthToday } from '@/lib/push/decide';
import { readItems, type InspectionKind } from '@/lib/inspections/model';
import { InspectionScreen, type InspectionView } from './inspection-screen';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Inspection · KBS Daily Diary' };

export default async function InspectionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { userId, memberships } = await requireUser();
  const supabase = await createClient();
  const { data: r } = await supabase
    .from('inspections')
    .select('*, project:projects!inner(name), inspection_actions(id, item_key, action, owner_name, due_on, done_at, done_note, created_by)')
    .eq('id', id)
    .maybeSingle();
  if (!r) notFound();
  const membership = memberships.find((m) => m.project_id === r.project_id);
  guardScreen(membership, 'inspections');
  const role = membership?.role ?? 'pm';
  const { data: crew } = await supabase.from('crew').select('name').eq('project_id', r.project_id).eq('active', true).order('sort_order').order('name');
  const project = Array.isArray(r.project) ? r.project[0] : r.project;
  const view: InspectionView = {
    id: r.id, projectId: r.project_id, template_name: r.template_name, kind: r.kind as InspectionKind, inspection_date: r.inspection_date,
    area: r.area, inspector_name: r.inspector_name, items: readItems(r.items), summary: r.summary, signature_path: r.signature_path,
    completed_at: r.completed_at, completed_on_device_at: r.completed_on_device_at,
    actions: ((r.inspection_actions ?? []) as InspectionView['actions']).slice().sort((a, b) => (a.due_on ?? '9999').localeCompare(b.due_on ?? '9999')),
    conducted_by: r.conducted_by,
  };
  return (
    <main className="sheet">
      <p className="label"><BrandMark size={18} /> {project.name}</p>
      <InspectionScreen inspection={view} crew={(crew ?? []).map((c) => String(c.name))} canManage={canAuthorEntries(role)} userId={userId} today={perthToday()} />
    </main>
  );
}
