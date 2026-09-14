import type { SupabaseClient } from '@supabase/supabase-js';
import { compliance, type DocFacts } from '@/lib/subcontractors/model';
import { expiring, normaliseName, type TicketFacts } from '@/lib/crew/tickets';
import { coverage } from '@/lib/documents-control/model';
import { injurySummary, daysSinceLastInjury, monthBuckets, overdue, openActions, type IncidentFacts, type ActionFacts } from './stats';

/**
 * Everything the dashboard shows, gathered once under the caller's RLS.
 * Each figure names where it came from so a PM can go and look.
 */
export interface SafetyData {
  today: string;
  onSiteNow: number;
  signInsThisWeek: number;
  prestartToday: 'done' | 'open' | 'none';
  taggedOut: string[];
  permits: { live: number; expired: number };
  /** `list` is the soonest-due `LISTED_ACTIONS`; `open` counts them all, so `open - list.length` is how many the table leaves out. */
  actions: { open: number; overdue: number; list: Array<{ source: 'incident' | 'inspection'; ref: string; href: string; action: string; owner: string | null; due_on: string | null }> };
  incidents: { open: number; year: ReturnType<typeof injurySummary>; daysSinceInjury: number | null; months: ReturnType<typeof monthBuckets> };
  inspections: { last90: number; issuesOpen: number };
  tickets: { expired: Array<{ person: string; label: string; on: string }>; soon: Array<{ person: string; label: string; on: string }> };
  subcontractors: Array<{ name: string; verdict: string }>;
  swms: Array<{ title: string; version: number; unsigned: string[] }>;
  documents: Array<{ title: string; version: number; unread: string[] }>;
}

const norm = normaliseName;
/** How many corrective actions the dashboard table lists before it says "and N more". */
export const LISTED_ACTIONS = 20;

export async function loadSafety(supabase: SupabaseClient, projectId: string, orgId: string, today: string): Promise<SafetyData> {
  const yearAgo = new Date(Date.parse(`${today}T00:00:00Z`) - 365 * 86_400_000).toISOString();
  const ninety = new Date(Date.parse(`${today}T00:00:00Z`) - 90 * 86_400_000).toISOString().slice(0, 10);
  const weekAgo = new Date(Date.parse(`${today}T00:00:00Z`) - 7 * 86_400_000).toISOString().slice(0, 10);
  const nowIso = new Date().toISOString();
  const [onSite, week, prestart, plant, permits, incidents, lastInjury, inspections, openIncActs, openInspActs, crew, tickets, subs, swms, docs, labour] = await Promise.all([
    supabase.from('site_signins').select('id', { count: 'exact', head: true }).eq('project_id', projectId).eq('signin_date', today).is('signed_out_at', null),
    supabase.from('site_signins').select('id', { count: 'exact', head: true }).eq('project_id', projectId).gte('signin_date', weekAgo),
    supabase.from('prestarts').select('completed_at').eq('project_id', projectId).eq('prestart_date', today).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('plant_prestarts').select('fit_for_use, completed_at, plant:plant_register!inner(name)').eq('project_id', projectId).eq('prestart_date', today),
    supabase.from('permits').select('valid_from, valid_to').eq('project_id', projectId).eq('status', 'issued'),
    supabase.from('incidents').select('id, seq, kind, occurred_at, treatment, status, notifiable, incident_actions(action, owner_name, due_on, done_at)').eq('project_id', projectId).gte('occurred_at', yearAgo),
    // The last injury ever, not the last within the year: "days since" is a lag indicator that keeps counting past 365.
    supabase.from('incidents').select('kind, occurred_at').eq('project_id', projectId).eq('kind', 'injury').order('occurred_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('inspections').select('id, completed_at').eq('project_id', projectId).gte('inspection_date', ninety),
    // Open corrective actions are open however old their report is: no date window on these two.
    supabase.from('incident_actions').select('action, owner_name, due_on, done_at, incident:incidents!inner(id, seq, project_id)').eq('incident.project_id', projectId).is('done_at', null),
    supabase.from('inspection_actions').select('action, owner_name, due_on, done_at, inspection:inspections!inner(id, template_name, inspection_date, project_id)').eq('inspection.project_id', projectId).is('done_at', null),
    supabase.from('crew').select('name').eq('project_id', projectId).eq('active', true),
    supabase.from('crew_tickets').select('person_name, ticket_type, expires_on, active').eq('org_id', orgId),
    supabase.from('project_subcontractors').select('subcontractor:subcontractors!inner(name, active, subcontractor_documents(kind, expires_on, active))').eq('project_id', projectId).is('engaged_to', null),
    supabase.from('swms').select('title, version, swms_signons(attendee_name)').eq('project_id', projectId).eq('status', 'active'),
    supabase.from('controlled_documents').select('title, requires_acknowledgement, document_versions(version, status, document_acknowledgements(person_name))').eq('org_id', orgId).eq('active', true).eq('requires_acknowledgement', true),
    supabase.from('labour').select('hours, overtime_hours, entry:entries!inner(project_id, status, entry_date)').eq('entry.project_id', projectId).eq('entry.status', 'signed').gte('entry.entry_date', yearAgo.slice(0, 10)),
  ]);

  const crewNames = ((crew.data ?? []) as Array<{ name: string }>).map((c) => c.name);
  const incRows = ((incidents.data ?? []) as Array<IncidentFacts & { id: string; seq: number }>);
  const inspRows = ((inspections.data ?? []) as Array<{ id: string; completed_at: string | null }>);
  const one = <T,>(v: T | T[]): T => (Array.isArray(v) ? v[0] : v);
  type OpenAction = ActionFacts & { action: string; owner_name: string | null };
  const incActs = ((openIncActs.data ?? []) as Array<OpenAction & { incident: { id: string; seq: number } | Array<{ id: string; seq: number }> }>);
  const inspActs = ((openInspActs.data ?? []) as Array<OpenAction & { inspection: { id: string; template_name: string; inspection_date: string } | Array<{ id: string; template_name: string; inspection_date: string }> }>);
  const actionList: SafetyData['actions']['list'] = [];
  for (const a of incActs) { const i = one(a.incident); actionList.push({ source: 'incident', ref: `INC-${String(i.seq).padStart(3, '0')}`, href: `/incidents/${i.id}`, action: a.action, owner: a.owner_name, due_on: a.due_on }); }
  for (const a of inspActs) { const i = one(a.inspection); actionList.push({ source: 'inspection', ref: `${i.template_name} ${i.inspection_date}`, href: `/inspections/${i.id}`, action: a.action, owner: a.owner_name, due_on: a.due_on }); }
  const allActions: ActionFacts[] = [...incActs, ...inspActs];
  actionList.sort((a, b) => (a.due_on ?? '9999').localeCompare(b.due_on ?? '9999'));

  const hours = ((labour.data ?? []) as Array<{ hours: number | string | null; overtime_hours: number | string | null }>).reduce((n, r) => n + (Number(r.hours) || 0) + (Number(r.overtime_hours) || 0), 0);
  const ticketRows = ((tickets.data ?? []) as Array<TicketFacts & { person_name: string }>).filter((t) => crewNames.some((c) => norm(c) === norm(t.person_name)));
  const { expired, soon } = expiring(ticketRows, today, 30);
  const label = (t: string) => t.replace(/_/g, ' ');
  const permitRows = (permits.data ?? []) as Array<{ valid_from: string; valid_to: string }>;
  const plantRows = (plant.data ?? []) as Array<{ fit_for_use: boolean | null; completed_at: string | null; plant: { name: string } | { name: string }[] }>;

  return {
    today,
    onSiteNow: onSite.count ?? 0,
    signInsThisWeek: week.count ?? 0,
    prestartToday: prestart.data ? (prestart.data.completed_at ? 'done' : 'open') : 'none',
    taggedOut: plantRows.filter((p) => p.completed_at && p.fit_for_use === false).map((p) => (Array.isArray(p.plant) ? p.plant[0] : p.plant).name),
    permits: { live: permitRows.filter((p) => p.valid_from <= nowIso && nowIso <= p.valid_to).length, expired: permitRows.filter((p) => p.valid_to < nowIso).length },
    actions: { open: openActions(allActions), overdue: overdue(allActions, today), list: actionList.slice(0, LISTED_ACTIONS) },
    incidents: {
      open: incRows.filter((i) => i.status !== 'closed').length,
      year: injurySummary(incRows, hours),
      daysSinceInjury: daysSinceLastInjury(lastInjury.data ? [lastInjury.data as { kind: string; occurred_at: string }] : [], today),
      months: monthBuckets(incRows, today, 6),
    },
    inspections: {
      last90: inspRows.filter((i) => i.completed_at).length,
      issuesOpen: inspActs.length,
    },
    tickets: {
      expired: expired.map((t) => ({ person: t.person_name, label: label(t.ticket_type), on: t.expires_on as string })),
      soon: soon.map((t) => ({ person: t.person_name, label: label(t.ticket_type), on: t.expires_on as string })),
    },
    subcontractors: ((subs.data ?? []) as Array<{ subcontractor: { name: string; active: boolean; subcontractor_documents: DocFacts[] } | Array<{ name: string; active: boolean; subcontractor_documents: DocFacts[] }> }>)
      .map((r) => (Array.isArray(r.subcontractor) ? r.subcontractor[0] : r.subcontractor))
      .filter((s) => s && s.active)
      .map((s) => ({ name: s.name, verdict: compliance(s.subcontractor_documents ?? [], today).verdict }))
      .filter((s) => s.verdict !== 'compliant'),
    swms: ((swms.data ?? []) as Array<{ title: string; version: number; swms_signons: Array<{ attendee_name: string }> }>)
      .map((s) => ({ title: s.title, version: s.version, unsigned: crewNames.filter((c) => !s.swms_signons.some((x) => norm(x.attendee_name) === norm(c))) }))
      .filter((s) => s.unsigned.length > 0),
    documents: ((docs.data ?? []) as Array<{ title: string; document_versions: Array<{ version: number; status: string; document_acknowledgements: Array<{ person_name: string }> }> }>)
      .map((d) => { const cur = d.document_versions.find((v) => v.status === 'current'); return cur ? { title: d.title, version: cur.version, unread: coverage(crewNames, cur.document_acknowledgements.map((a) => a.person_name)).unread } : null; })
      .filter((d): d is { title: string; version: number; unread: string[] } => Boolean(d && d.unread.length > 0)),
  };
}
