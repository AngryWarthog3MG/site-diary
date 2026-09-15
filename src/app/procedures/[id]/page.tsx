import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject, canRunTalks } from '@/lib/auth';
import { sees, canAuthorEntries } from '@/lib/roles';
import { BrandMark } from '@/components/brand-mark';
import { OutboxStatus } from '@/components/outbox-status';
import { type ControlledKind } from '@/lib/documents-control/model';
import { ProcedureScreen, type ProcedureView } from './procedure-screen';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Document · KBS Daily Diary' };

export default async function ProcedurePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ project?: string }> }) {
  const { id } = await params;
  const { userId, memberships } = await requireUser();
  const { project } = await searchParams;
  const current = resolveProject(memberships, project);
  if (!current) redirect('/');
  if (!sees(current, 'procedures')) redirect(`/?project=${current.project_id}`);
  const supabase = await createClient();
  const [{ data: d }, { data: crew }] = await Promise.all([
    supabase.from('controlled_documents').select('*, document_versions(id, version, file_path, summary, status, issued_at, superseded_at, document_acknowledgements(id, person_name, signature_path, acknowledged_on_device_at, project_id))').eq('id', id).maybeSingle(),
    supabase.from('crew').select('name').eq('project_id', current.project_id).eq('active', true).order('sort_order').order('name'),
  ]);
  if (!d) notFound();
  const versions = ((d.document_versions ?? []) as ProcedureView['versions']).slice().sort((a, b) => b.version - a.version);
  const view: ProcedureView = {
    id: d.id, orgId: d.org_id, title: d.title, kind: d.kind as ControlledKind, doc_number: d.doc_number, requires_acknowledgement: d.requires_acknowledgement, active: d.active,
    versions: versions.map((v) => ({ ...v, document_acknowledgements: (v.document_acknowledgements ?? []).slice().sort((a, b) => a.acknowledged_on_device_at.localeCompare(b.acknowledged_on_device_at)) })),
  };
  return (
    <main className="sheet">
      <p className="label"><BrandMark size={18} /> {current.project.org.name}</p>
      <OutboxStatus />
      <ProcedureScreen doc={view} projectId={current.project_id} crew={(crew ?? []).map((c) => String(c.name))} canManage={canAuthorEntries(current.role)} canSign={canRunTalks(current.role)} userId={userId} />
    </main>
  );
}
