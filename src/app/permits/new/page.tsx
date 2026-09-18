import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject } from '@/lib/auth';
import { canAuthorEntries } from '@/lib/roles';
import { BrandMark } from '@/components/brand-mark';
import { PermitForm } from './permit-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Raise a permit · Kooboolong IMS' };

export default async function NewPermitPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { userId, memberships } = await requireUser();
  const { project } = await searchParams;
  const current = resolveProject(memberships, project);
  if (!current) redirect('/');
  if (!canAuthorEntries(current.role)) redirect(`/permits?project=${current.project_id}`);
  const supabase = await createClient();
  const [{ data: crew }, { data: swms }, { data: me }, { data: plant }] = await Promise.all([
    supabase.from('crew').select('name').eq('project_id', current.project_id).eq('active', true).order('sort_order').order('name'),
    supabase.from('swms').select('id, title, version, kind, swms_signons(attendee_name)').eq('project_id', current.project_id).eq('status', 'active').order('title'),
    supabase.from('profiles').select('full_name').eq('id', userId).maybeSingle(),
    supabase.from('project_plant').select('plant:plant_register!inner(name)').eq('project_id', current.project_id),
  ]);
  return (
    <main className="sheet">
      <p className="label"><BrandMark size={18} /> {current.project.name}</p>
      <h1 className="page-title">Raise a permit</h1>
      <PermitForm
        projectId={current.project_id} userId={userId} issuer={(me?.full_name as string | null) ?? ''}
        crew={(crew ?? []).map((c) => String(c.name))}
        plant={(plant ?? []).map((p) => { const r = Array.isArray(p.plant) ? p.plant[0] : p.plant; return String((r as { name: string } | null)?.name ?? ''); }).filter(Boolean)}
        swms={(swms ?? []).map((s) => ({ id: s.id as string, title: `${String(s.kind).toUpperCase()} v${s.version} · ${s.title}`, signed: ((s.swms_signons ?? []) as Array<{ attendee_name: string }>).map((x) => x.attendee_name) }))}
      />
    </main>
  );
}
