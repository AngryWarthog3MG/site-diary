import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, canReport } from '@/lib/auth';
import { canAuthorEntries, canRunTalks } from '@/lib/roles';
import { BrandMark } from '@/components/brand-mark';
import { perthToday } from '@/lib/push/decide';
import { IncidentScreen, type IncidentView } from './incident-screen';
import { RegulatorPanel } from './regulator-panel';
import type { RegulatorEvent } from '@/lib/incidents/regulator';
import { EnvironmentPanel } from './environment-panel';
import { HeadContractorPanel } from './head-contractor-panel';
import type { IncidentNotice } from '@/lib/subcontract/model';
import type { EnvEvent } from '@/lib/environment/model';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Incident · KBS Daily Diary' };

export default async function IncidentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { userId, memberships, profile } = await requireUser();
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
  const environmental = r.kind === 'environmental' && role !== 'labourer';
  const [{ data: crew }, { data: regRows }, { data: envRows }, { data: clocks }, { data: job }, { data: noticeRows }] = await Promise.all([
    supabase.from('crew').select('name').eq('project_id', r.project_id).eq('active', true).order('sort_order').order('name'),
    // Read under RLS: a labourer, who does not read the record, gets none and no panel is drawn for them.
    supabase.from('incident_regulator_events').select('id, kind, happened_at, method, person_name, detail').eq('incident_id', r.id),
    environmental
      ? supabase.from('incident_environment_events').select('id, kind, happened_at, severity, serious, dwer_trigger, person_name, detail').eq('incident_id', r.id)
      : Promise.resolve({ data: [] }),
    environmental
      ? supabase.from('projects').select('env_report_hours_serious, env_report_hours_minor, env_investigation_days').eq('id', r.project_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from('projects').select('principal_contractor, is_principal_contractor, head_contractor_incident_hours').eq('id', r.project_id).maybeSingle(),
    // Read under RLS: a labourer gets none, and the panel is not drawn for them.
    supabase.from('incident_notices').select('id, notified_at, method, told_by_name, recipient_name, reference, detail').eq('incident_id', r.id),
  ]);
  const jobRow = job as { principal_contractor: string | null; is_principal_contractor: boolean; head_contractor_incident_hours: number | null } | null;
  const underHeadContractor = role !== 'labourer' && jobRow != null && !jobRow.is_principal_contractor;
  const clockRow = clocks as { env_report_hours_serious: number | null; env_report_hours_minor: number | null; env_investigation_days: number | null } | null;
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
      <IncidentScreen
        incident={view}
        crew={(crew ?? []).map((c) => String(c.name))}
        canReport={canReport(role)}
        canManage={canAuthorEntries(role)}
        userId={userId}
        today={perthToday()}
        regulator={role === 'labourer' ? null : (
          <>
          {underHeadContractor && (
            <HeadContractorPanel
              incidentId={r.id}
              occurredAt={r.occurred_at}
              contractor={jobRow!.principal_contractor}
              hours={jobRow!.head_contractor_incident_hours}
              notices={(noticeRows ?? []) as IncidentNotice[]}
              canRecord={canRunTalks(role)}
              defaultName={profile?.full_name ?? ''}
              now={new Date().toISOString()}
            />
          )}
          {environmental && (
            <EnvironmentPanel
              incidentId={r.id}
              occurredAt={r.occurred_at}
              events={(envRows ?? []) as EnvEvent[]}
              clocks={{ seriousHours: clockRow?.env_report_hours_serious ?? null, minorHours: clockRow?.env_report_hours_minor ?? null, investigationDays: clockRow?.env_investigation_days ?? null }}
              canManage={canAuthorEntries(role)}
              now={new Date().toISOString()}
            />
          )}
          <RegulatorPanel
            incidentId={r.id}
            notifiable={Boolean(r.notifiable)}
            events={(regRows ?? []) as RegulatorEvent[]}
            canManage={canAuthorEntries(role)}
            now={new Date().toISOString()}
          />
          </>
        )}
      />
    </main>
  );
}
