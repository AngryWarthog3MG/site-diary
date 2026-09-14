import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, canRunTalks } from '@/lib/auth';
import { canAuthorEntries } from '@/lib/roles';
import { BrandMark } from '@/components/brand-mark';
import { OutboxStatus } from '@/components/outbox-status';
import { readSteps, type SwmsKind } from '@/lib/swms/model';
import { SwmsScreen, type SwmsView } from './swms-screen';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'SWMS · KBS Daily Diary' };

/** One method statement: read it, put it into use, sign the crew on, print it. */
export default async function SwmsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { userId, memberships } = await requireUser();
  const supabase = await createClient();
  const { data: s } = await supabase
    .from('swms')
    .select('*, project:projects!inner(name), swms_signons(id, attendee_name, signature_path, signed_on_device_at, created_at)')
    .eq('id', id)
    .maybeSingle();
  if (!s) notFound();
  const membership = memberships.find((m) => m.project_id === s.project_id);
  const role = membership?.role ?? 'pm';
  const [{ data: crew }, { data: newer }] = await Promise.all([
    supabase.from('crew').select('name').eq('project_id', s.project_id).eq('active', true).order('sort_order').order('name'),
    supabase.from('swms').select('id, version, status').eq('supersedes_id', s.id).order('version', { ascending: false }).limit(1).maybeSingle(),
  ]);
  const project = Array.isArray(s.project) ? s.project[0] : s.project;
  const view: SwmsView = {
    id: s.id, projectId: s.project_id, kind: s.kind as SwmsKind, title: s.title, activity: s.activity ?? null,
    hrcw: s.hrcw ?? [], ppe: s.ppe ?? [], permits: s.permits ?? null, plant: s.plant ?? null, legislation: s.legislation ?? null,
    prepared_by: s.prepared_by ?? null, reviewed_by: s.reviewed_by ?? null, version: s.version, status: s.status,
    activated_at: s.activated_at ?? null, steps: readSteps(s.steps),
    signons: ((s.swms_signons ?? []) as SwmsView['signons']).slice().sort((a, b) => a.signed_on_device_at.localeCompare(b.signed_on_device_at)),
    newer: newer ? { id: newer.id as string, version: newer.version as number, status: newer.status as string } : null,
  };
  return (
    <main className="sheet sheet--wide">
      <p className="label"><BrandMark size={18} /> {project.name}</p>
      <OutboxStatus />
      <SwmsScreen swms={view} crew={(crew ?? []).map((c) => String(c.name))} canWrite={canAuthorEntries(role)} canSign={canRunTalks(role)} userId={userId} />
    </main>
  );
}
