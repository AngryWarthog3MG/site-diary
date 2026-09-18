import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, guardScreen } from '@/lib/auth';
import { canAuthorEntries } from '@/lib/roles';
import { BrandMark } from '@/components/brand-mark';
import { readControls, type PermitKind, type PermitStatus } from '@/lib/permits/model';
import { PermitScreen, type PermitView } from './permit-screen';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Permit · Kooboolong IMS' };

export default async function PermitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { userId, memberships } = await requireUser();
  const supabase = await createClient();
  const { data: r } = await supabase.from('permits').select('*, project:projects!inner(name), swms:swms(title, version, kind)').eq('id', id).maybeSingle();
  if (!r) notFound();
  const membership = memberships.find((m) => m.project_id === r.project_id);
  guardScreen(membership, 'permits');
  const role = membership?.role ?? 'pm';
  const project = Array.isArray(r.project) ? r.project[0] : r.project;
  const swms = (Array.isArray(r.swms) ? r.swms[0] : r.swms) as { title: string; version: number; kind: string } | null;
  const view: PermitView = {
    id: r.id, projectId: r.project_id, seq: r.seq, kind: r.kind as PermitKind, title: r.title, location: r.location, valid_from: r.valid_from, valid_to: r.valid_to,
    swms: swms ? `${swms.kind.toUpperCase()} v${swms.version} · ${swms.title}` : null, swms_id: r.swms_id, plant: r.plant, workers: r.workers ?? [],
    controls: readControls(r.controls), conditions: r.conditions, issuer_name: r.issuer_name, holder_name: r.holder_name,
    issuer_signature_path: r.issuer_signature_path, holder_signature_path: r.holder_signature_path, issued_at: r.issued_at, issued_on_device_at: r.issued_on_device_at,
    status: r.status as PermitStatus, closeout_checks: r.closeout_checks ? readControls(r.closeout_checks) : null, closeout_note: r.closeout_note,
    closeout_signature_path: r.closeout_signature_path, closed_at: r.closed_at, closed_on_device_at: r.closed_on_device_at, cancel_reason: r.cancel_reason, issued_by: r.issued_by,
  };
  return (
    <main className="sheet">
      <p className="label"><BrandMark size={18} /> {project.name}</p>
      <PermitScreen permit={view} canManage={canAuthorEntries(role)} userId={userId} />
    </main>
  );
}
