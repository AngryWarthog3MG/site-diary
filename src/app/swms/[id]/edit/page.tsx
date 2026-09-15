import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, guardScreen } from '@/lib/auth';
import { canAuthorEntries } from '@/lib/roles';
import { BrandMark } from '@/components/brand-mark';
import { readSteps, type SwmsKind } from '@/lib/swms/model';
import { SwmsForm } from '../../new/swms-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Edit SWMS · KBS Daily Diary' };

/** A draft, edited. Anything in use is revised instead — the page refuses. */
export default async function EditSwmsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { userId, memberships } = await requireUser();
  const supabase = await createClient();
  const { data: s } = await supabase.from('swms').select('*, project:projects!inner(name)').eq('id', id).maybeSingle();
  if (!s) notFound();
  const membership = memberships.find((m) => m.project_id === s.project_id);
  guardScreen(membership, 'swms');
  if (!membership || !canAuthorEntries(membership.role)) redirect(`/swms/${id}`);
  if (s.status !== 'draft') redirect(`/swms/${id}`);
  const { data: crew } = await supabase.from('crew').select('name').eq('project_id', s.project_id).eq('active', true).order('sort_order').order('name');
  const project = Array.isArray(s.project) ? s.project[0] : s.project;
  return (
    <main className="sheet sheet--wide">
      <p className="label"><BrandMark size={18} /> {project.name}</p>
      <h1 className="page-title">Edit: {s.title}</h1>
      <SwmsForm
        projectId={s.project_id}
        userId={userId}
        swmsId={s.id}
        crew={(crew ?? []).map((c) => String(c.name))}
        initial={{
          kind: s.kind as SwmsKind, title: s.title, activity: s.activity ?? '', hrcw: s.hrcw ?? [], ppe: s.ppe ?? [],
          permits: s.permits ?? '', plant: s.plant ?? '', legislation: s.legislation ?? '',
          prepared_by: s.prepared_by ?? '', reviewed_by: s.reviewed_by ?? '', steps: readSteps(s.steps),
        }}
      />
    </main>
  );
}
