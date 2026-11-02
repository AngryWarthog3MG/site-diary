import type { SupabaseClient } from '@supabase/supabase-js';
import { compliance, type DocFacts } from '@/lib/subcontractors/model';
import { expiring, normaliseName, type TicketFacts } from '@/lib/crew/tickets';
import { coverage } from '@/lib/documents-control/model';
import { injurySummary, daysSinceLastInjury, monthBuckets, overdue, openActions, type IncidentFacts } from './stats';
import { perthWindowDate, perthWindowEnd, perthWindowStart } from './window';
import { originHref, sortActions, type ActionOrigin, type RegisterRow } from '@/lib/actions/model';
import { summariseHazards, type ControlFacts } from '@/lib/incidents/controls';

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
  actions: { open: number; overdue: number; list: Array<{ source: ActionOrigin; ref: string; href: string; action: string; owner: string | null; due_on: string | null }> };
  incidents: {
    open: number; year: ReturnType<typeof injurySummary>; daysSinceInjury: number | null; months: ReturnType<typeof monthBuckets>;
    /** Every report in the last twelve months, newest first — the home cards count the last 30 days from it. */
    recent: Array<IncidentFacts & { id: string; seq: number; description: string }>;
  };
  inspections: { last90: number; issuesOpen: number };
  /** Open hazard reports and how many have no control in place (README R179) — the register's own arithmetic. */
  hazards: ReturnType<typeof summariseHazards>;
  tickets: { expired: Array<{ person: string; label: string; on: string }>; soon: Array<{ person: string; label: string; on: string }> };
  subcontractors: Array<{ name: string; verdict: string }>;
  swms: Array<{ title: string; version: number; unsigned: string[] }>;
  documents: Array<{ title: string; version: number; unread: string[] }>;
}

const norm = normaliseName;
/** How many corrective actions the dashboard table lists before it says "and N more". */
export const LISTED_ACTIONS = 20;

export async function loadSafety(supabase: SupabaseClient, projectId: string, orgId: string, today: string): Promise<SafetyData> {
  // Every window counts today as its last day and opens at Perth midnight, so the
  // injuries (timestamps) and the labour hours (dates) under a rate cover the same days.
  const yearAgo = perthWindowStart(today, 365);
  const endOfToday = perthWindowEnd(today); // and nothing dated after today, however it got there
  const yearAgoDate = perthWindowDate(today, 365);
  const ninety = perthWindowDate(today, 90);
  const weekAgo = perthWindowDate(today, 7);
  const nowIso = new Date().toISOString();
  const [onSite, week, prestart, plant, permits, incidents, lastInjury, inspections, openActs, openHazards, crew, tickets, subs, swms, docs, labour] = await Promise.all([
    supabase.from('site_signins').select('id', { count: 'exact', head: true }).eq('project_id', projectId).eq('signin_date', today).is('signed_out_at', null),
    supabase.from('site_signins').select('id', { count: 'exact', head: true }).eq('project_id', projectId).gte('signin_date', weekAgo).lte('signin_date', today),
    supabase.from('prestarts').select('completed_at').eq('project_id', projectId).eq('prestart_date', today).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('plant_prestarts').select('fit_for_use, completed_at, plant:plant_register!inner(name)').eq('project_id', projectId).eq('prestart_date', today),
    supabase.from('permits').select('valid_from, valid_to').eq('project_id', projectId).eq('status', 'issued'),
    supabase.from('incidents').select('id, seq, kind, occurred_at, treatment, status, notifiable, description').eq('project_id', projectId).gte('occurred_at', yearAgo).lt('occurred_at', endOfToday).order('occurred_at', { ascending: false }),
    // The last injury ever, not the last within the year: "days since" is a lag indicator that keeps counting past 365.
    supabase.from('incidents').select('kind, occurred_at').eq('project_id', projectId).eq('kind', 'injury').order('occurred_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('inspections').select('id, completed_at').eq('project_id', projectId).gte('inspection_date', ninety).lte('inspection_date', today),
    // Open actions of every origin, this job's and the company-wide ones, through the action register (README R177):
    // open however old their record is, so no date window.
    supabase.from('action_register').select('origin, record_id, record_ref, project_id, action, owner_name, priority, due_on, done_at, raised_at').eq('org_id', orgId).or(`project_id.eq.${projectId},project_id.is.null`).is('done_at', null),
    supabase.from('incidents').select('kind, status, critical_risk, hazard_controls(level, status)').eq('project_id', projectId).eq('kind', 'hazard').neq('status', 'closed'),
    supabase.from('crew').select('name').eq('project_id', projectId).eq('active', true),
    supabase.from('crew_tickets').select('person_name, ticket_type, expires_on, active').eq('org_id', orgId),
    supabase.from('project_subcontractors').select('subcontractor:subcontractors!inner(name, active, subcontractor_documents(kind, expires_on, active))').eq('project_id', projectId).is('engaged_to', null),
    supabase.from('swms').select('title, version, swms_signons(attendee_name)').eq('project_id', projectId).eq('status', 'active'),
    supabase.from('controlled_documents').select('title, requires_acknowledgement, document_versions(version, status, document_acknowledgements(person_name))').eq('org_id', orgId).eq('active', true).eq('requires_acknowledgement', true),
    supabase.from('labour').select('hours, overtime_hours, entry:entries!inner(project_id, status, entry_date)').eq('entry.project_id', projectId).eq('entry.status', 'signed').gte('entry.entry_date', yearAgoDate).lte('entry.entry_date', today),
  ]);

  const crewNames = ((crew.data ?? []) as Array<{ name: string }>).map((c) => c.name);
  const incRows = ((incidents.data ?? []) as Array<IncidentFacts & { id: string; seq: number; description: string }>);
  const inspRows = ((inspections.data ?? []) as Array<{ id: string; completed_at: string | null }>);
  type OpenAction = Pick<RegisterRow, 'origin' | 'record_id' | 'record_ref' | 'project_id' | 'action' | 'owner_name' | 'priority' | 'due_on' | 'done_at' | 'raised_at'>;
  const allActions = sortActions((openActs.data ?? []) as OpenAction[], today);
  const actionList: SafetyData['actions']['list'] = allActions.map((a) => ({
    source: a.origin, ref: a.record_ref ?? 'By hand', href: originHref(a, '') ?? '/actions', action: a.action, owner: a.owner_name, due_on: a.due_on,
  }));

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
    hazards: summariseHazards(((openHazards.data ?? []) as Array<{ kind: string; status: string; critical_risk: boolean; hazard_controls: ControlFacts[] | null }>).map((h) => ({ kind: h.kind, status: h.status, critical_risk: h.critical_risk, controls: h.hazard_controls ?? [] }))),
    incidents: {
      open: incRows.filter((i) => i.status !== 'closed').length,
      year: injurySummary(incRows, hours),
      daysSinceInjury: daysSinceLastInjury(lastInjury.data ? [lastInjury.data as { kind: string; occurred_at: string }] : [], today),
      months: monthBuckets(incRows, today, 6),
      recent: incRows,
    },
    inspections: {
      last90: inspRows.filter((i) => i.completed_at).length,
      issuesOpen: allActions.filter((a) => a.origin === 'inspection').length,
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
