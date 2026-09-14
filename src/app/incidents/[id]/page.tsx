import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, canRunTalks } from '@/lib/auth';
import { canAuthorEntries } from '@/lib/roles';
import { BrandMark } from '@/components/brand-mark';
import { perthToday } from '@/lib/push/decide';
import { IncidentScreen, type IncidentView } from './incident-screen';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Incident · KBS Daily Diary' };

export default async function IncidentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { userId, memberships } = await requireUser();
  const supabase = await createClient();
  const { data: r } = await supabase
    .from('incidents')
    .select(`*, project:projects!inner(name),
      reporter:profiles!incidents_reported_by_profiles_fkey(full_name, email),
      incident_updates(id, kind, body, photo_urls, created_at, author:profiles!incident_updates_created_by_profiles_fkey(full_name, email)),
      incident_actions(id, action, owner_name, due_on, done_at, done_note, created_by)`)
    .eq('id', id)
    .maybeSingle();
  if (!r) notFound();
  const membership = memberships.find((m) => m.project_id === r.project_id);
  const role = membership?.role ?? 'pm';
  const { data: crew } = await supabase.from('crew').select('name').eq('project_id', r.project_id).eq('active', true).order('sort_order').order('name');
  const project = Array.isArray(r.project) ? r.project[0] : r.project;
  const who = (p: unknown) => { const x = (Array.isArray(p) ? p[0] : p) as { full_name?: string | null; email?: string | null } | null; return x?.full_name ?? x?.email ?? '—'; };
  const view: IncidentView = {
    id: r.id, projectId: r.project_id, seq: r.seq, kind: r.kind, status: r.status, occurred_at: r.occurred_at,
    reported_at: r.reported_at, reported_on_device_at: r.reported_on_device_at, reported_by_name: who(r.reporter),
    location: r.location, description: r.description, immediate_actions: r.immediate_actions,
    people_involved: r.people_involved ?? [], witnesses: r.witnesses ?? [], injured_name: r.injured_name, injury_type: r.injury_type,
    body_part: r.body_part, treatment: r.treatment, actual_severity: r.actual_severity, potential_severity: r.potential_severity,
    notifiable: r.notifiable, plant: r.plant, photo_urls: r.photo_urls ?? [], closed_at: r.closed_at, notified_at: r.notified_at,
    updates: ((r.incident_updates ?? []) as Array<{ id: string; kind: string; body: string; photo_urls: string[]; created_at: string; author: unknown }>)
      .map((u) => ({ id: u.id, kind: u.kind, body: u.body, photo_urls: u.photo_urls ?? [], created_at: u.created_at, by: who(u.author) }))
      .sort((a, b) => a.created_at.localeCompare(b.created_at)),
    actions: ((r.incident_actions ?? []) as IncidentView['actions']).slice().sort((a, b) => (a.due_on ?? '9999').localeCompare(b.due_on ?? '9999')),
  };
  return (
    <main className="sheet">
      <p className="label"><BrandMark size={18} /> {project.name}</p>
      <IncidentScreen incident={view} crew={(crew ?? []).map((c) => String(c.name))} canReport={canRunTalks(role)} canManage={canAuthorEntries(role)} userId={userId} today={perthToday()} />
    </main>
  );
}
