import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject, canRunTalks } from '@/lib/auth';
import { BrandMark } from '@/components/brand-mark';
import { perthToday } from '@/lib/push/decide';
import { readTemplateItems, type InspectionKind } from '@/lib/inspections/model';
import { InspectionForm, type TemplateChoice } from './inspection-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'New inspection · KBS Daily Diary' };

export default async function NewInspectionPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { userId, memberships } = await requireUser();
  const { project } = await searchParams;
  const current = resolveProject(memberships, project);
  if (!current) redirect('/');
  if (!canRunTalks(current.role)) redirect(`/inspections?project=${current.project_id}`);
  const supabase = await createClient();
  const [{ data: templates }, { data: me }] = await Promise.all([
    supabase.from('inspection_templates').select('id, name, kind, items').eq('org_id', current.project.org.id).eq('active', true).order('name'),
    supabase.from('profiles').select('full_name').eq('id', userId).maybeSingle(),
  ]);
  const own: TemplateChoice[] = (templates ?? []).map((t) => ({ id: t.id as string, name: t.name as string, kind: t.kind as InspectionKind, items: readTemplateItems(t.items) }));
  return (
    <main className="sheet">
      <p className="label"><BrandMark size={18} /> {current.project.name}</p>
      <h1 className="page-title">Inspection</h1>
      <InspectionForm projectId={current.project_id} userId={userId} today={perthToday()} inspector={(me?.full_name as string | null) ?? ''} templates={own} />
    </main>
  );
}
