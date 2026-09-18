import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject } from '@/lib/auth';
import { canAuthorEntries } from '@/lib/roles';
import { BrandMark } from '@/components/brand-mark';
import { readTemplateItems, type InspectionKind } from '@/lib/inspections/model';
import { TemplatesEditor } from './templates-editor';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Inspection templates · Kooboolong IMS' };

export default async function TemplatesPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { userId, memberships } = await requireUser();
  const { project } = await searchParams;
  const current = resolveProject(memberships, project);
  if (!current) redirect('/');
  if (!canAuthorEntries(current.role)) redirect(`/inspections?project=${current.project_id}`);
  const supabase = await createClient();
  const { data } = await supabase.from('inspection_templates').select('id, name, kind, items, active').eq('org_id', current.project.org.id).order('name');
  return (
    <main className="sheet">
      <p className="label"><BrandMark size={18} /> {current.project.org.name}</p>
      <h1 className="page-title">Inspection templates</h1>
      <p className="page-subtitle">The company&rsquo;s checklists, one item per line. An inspection copies the items the day it is done, so editing a template never changes an old record.</p>
      <TemplatesEditor orgId={current.project.org.id} userId={userId} initial={(data ?? []).map((t) => ({ id: t.id as string, name: t.name as string, kind: t.kind as InspectionKind, active: Boolean(t.active), items: readTemplateItems(t.items) }))} />
    </main>
  );
}
