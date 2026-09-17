import type { SupabaseClient } from '@supabase/supabase-js';
import { TICKET_LABEL, normaliseName, type TicketType } from '@/lib/crew/tickets';
import { loadChemicals } from '@/lib/chemicals/load';
import { SDS_STATUS_LABEL } from '@/lib/chemicals/model';
import { regulatorState, perthDay, type RegulatorEvent } from '@/lib/incidents/regulator';
import { incidentRef } from '@/lib/incidents/model';
import { loadEmergency } from '@/lib/emergency/load';
import { withoutWhiteCard } from '@/lib/construction/model';
import { registerInForce, planReviewDue, notBriefed } from '@/lib/asbestos/model';
import { programmesDue } from '@/lib/health/model';
import { envIncidentState, rainPrompts, type EnvEvent } from '@/lib/environment/model';
import { currentDocs, noticeState, swmsReviewStatus, headContractorName, HC_DOC_EXPECTED, HC_DOC_LABEL, type HcDoc, type IncidentNotice, type SwmsReview } from '@/lib/subcontract/model';
import { ncrRef, lotRef, ncrReportState, holdsAwaitingRelease, calibrationStatus, CALIBRATION_LABEL, type PointType, type Result } from '@/lib/quality/model';
import { nextInspection, registrationStatus, REGISTRATION_LABEL, type InspectionBasis, type RecordKind, type Outcome } from '@/lib/plant/inspections';
import {
  dueStatus, nextDue, onTime, sortItems, summarise, KIND_LABEL,
  type ObligationItem, type ObligationKind,
} from './model';

/**
 * Everything that falls due on this job, in one list.
 *
 * Scheduled obligations are read from their table. Derived ones are read off
 * the records that already carry their dates — a sheet's issue date, a ticket's
 * expiry — and never copied, so the list can never disagree with the record it
 * came from. Read under the caller's RLS: a labourer gets no scheduled rows,
 * and this screen is not one of their doors.
 */

export interface ScheduledRow {
  id: string;
  project_id: string | null;
  kind: ObligationKind;
  title: string;
  basis: string | null;
  interval_months: number | null;
  first_due_on: string;
  active: boolean;
  obligation_completions: Array<{ id: string; due_on: string; done_on: string; evidence_note: string; evidence_ref: string | null; created_at: string; done_by: string | null }>;
}

export interface ObligationsData {
  items: ObligationItem[];
  summary: ReturnType<typeof summarise>;
  scheduled: ScheduledRow[];
}

function addDaysIso(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function loadObligations(
  supabase: SupabaseClient,
  projectId: string,
  orgId: string,
  today: string,
): Promise<ObligationsData> {
  const q = `?project=${projectId}`;
  const [{ data: schedRows }, chemicals, { data: crewRows }, { data: ticketRows }, { data: notifiableRows }, { data: regRows }, emergency, { data: plantRows }, { data: pcRow }, { data: whsPlanRows }, { data: whiteCards }, { data: ncrRows }, { data: openLots }, { data: equipRows }, { data: findingRows }, { data: reviewActionRows }, { data: asbestosRows }, { data: healthRows }, { data: envApplies }, { data: envIncidents }, { data: envSettings }, { data: envWeather }, { data: envChecks }, { data: envActions }, { data: subIncidents }, { data: hcDocRows }, { data: swmsRows }] = await Promise.all([
    supabase
      .from('obligations')
      .select('id, project_id, kind, title, basis, interval_months, first_due_on, active, obligation_completions(id, due_on, done_on, evidence_note, evidence_ref, created_at, done_by)')
      .eq('org_id', orgId)
      .or(`project_id.eq.${projectId},project_id.is.null`)
      .order('first_due_on'),
    loadChemicals(supabase, projectId, orgId, today),
    supabase.from('crew').select('name').eq('project_id', projectId).eq('active', true),
    supabase.from('crew_tickets').select('id, person_name, ticket_type, expires_on, active').eq('org_id', orgId).eq('active', true).not('expires_on', 'is', null),
    supabase.from('incidents').select('id, seq, notifiable').eq('project_id', projectId).eq('notifiable', true),
    supabase.from('incident_regulator_events').select('id, kind, happened_at, method, person_name, detail, incident:incidents!inner(id, seq, notifiable, project_id)').eq('incident.project_id', projectId),
    loadEmergency(supabase, projectId),
    supabase.from('project_plant').select('plant:plant_register!inner(id, name, active, inspection_basis, inspection_interval_months, registration_required, registration_no, registration_expires_on, plant_maintenance_records(kind, done_on, next_due_on, outcome))').eq('project_id', projectId).eq('active', true),
    supabase.from('projects').select('is_principal_contractor, ncr_report_hours, principal_contractor, head_contractor_incident_hours').eq('id', projectId).maybeSingle(),
    supabase.from('whs_management_plans').select('id').eq('project_id', projectId).limit(1),
    supabase.from('crew_tickets').select('person_name, ticket_type, active, expires_on').eq('org_id', orgId).eq('ticket_type', 'white_card'),
    supabase.from('ncrs').select('id, seq, status, detected_at, reported_to_principal_at').eq('project_id', projectId).neq('status', 'closed'),
    supabase.from('lots').select('id, seq, description, itp:itps!inner(itp_points(id, seq, inspection_test, point_type, uses_calibrated_equipment)), lot_checks(itp_point_id, result, created_at), hold_point_releases(itp_point_id)').eq('project_id', projectId).eq('status', 'open'),
    supabase.from('measuring_equipment').select('id, name, active, equipment_calibrations(calibrated_on, due_on, certificate_no)').eq('org_id', orgId).eq('active', true),
    supabase.from('audit_findings').select('id, seq, action, due_on, audit:audits!inner(id, org_id, project_id, status, audit_date)').is('done_at', null).not('action', 'is', null).eq('audit.org_id', orgId).eq('audit.status', 'issued').or(`project_id.eq.${projectId},project_id.is.null`, { referencedTable: 'audit' }),
    supabase.from('review_actions').select('id, action, due_on, review:management_reviews!inner(id, org_id, project_id, status, held_on)').is('done_at', null).eq('review.org_id', orgId).eq('review.status', 'issued').or(`project_id.eq.${projectId},project_id.is.null`, { referencedTable: 'review' }),
    supabase.from('asbestos_registers').select('id, register_date, superseded_by, asbestos_present, plan_date, plan_file_path, asbestos_acknowledgements(person_name)').eq('project_id', projectId),
    // Keepers only, under RLS: anyone else gets no rows, and so no health items.
    supabase.from('health_monitoring_records').select('program_id, person_name, monitored_on, next_due_on, program:health_monitoring_programs!inner(id, hazard, org_id, active)').eq('program.org_id', orgId).eq('program.active', true),
    // Environment (README R73), under RLS like everything here.
    supabase.from('project_env_aspects').select('aspect_id').eq('project_id', projectId).eq('applies', true),
    supabase.from('incidents').select('id, seq, occurred_at, incident_environment_events(id, kind, happened_at, severity, serious, dwer_trigger, person_name, detail)').eq('project_id', projectId).eq('kind', 'environmental').neq('status', 'closed'),
    supabase.from('projects').select('env_report_hours_serious, env_report_hours_minor, env_investigation_days, env_rain_inspection_mm').eq('id', projectId).maybeSingle(),
    supabase.from('project_weather_days').select('day, rainfall_mm').eq('project_id', projectId).gte('day', addDaysIso(today, -15)),
    supabase.from('inspections').select('inspection_date').eq('project_id', projectId).eq('kind', 'environmental').gte('inspection_date', addDaysIso(today, -15)),
    supabase.from('compliance_evaluation_results').select('id, action, due_on, evaluation:compliance_evaluations!inner(id, org_id, project_id, status, evaluated_on)').eq('result', 'non_compliant').is('done_at', null).eq('evaluation.org_id', orgId).eq('evaluation.status', 'issued').or(`project_id.eq.${projectId},project_id.is.null`, { referencedTable: 'evaluation' }),
    // Working under a head contractor (README R74): the last 90 days' reports and whether each was told up,
    // their plans on file, and the SWMS in use with where each stands in their review.
    supabase.from('incidents').select('id, seq, kind, occurred_at, incident_notices(id, notified_at, method, told_by_name, recipient_name, reference, detail)').eq('project_id', projectId).gte('occurred_at', new Date(Date.now() - 90 * 86_400_000).toISOString()),
    supabase.from('head_contractor_documents').select('id, kind, title, revision, received_on, file_path, superseded_by, notes').eq('project_id', projectId),
    supabase.from('swms').select('id, title, version, swms_reviews(id, kind, happened_on, person_name, reference, comments, created_at)').eq('project_id', projectId).eq('status', 'active'),
  ]);
  const job = pcRow as { is_principal_contractor?: boolean; principal_contractor?: string | null; head_contractor_incident_hours?: number | null } | null;
  const subcontract = job != null && !job.is_principal_contractor;
  const hcName = headContractorName(job?.principal_contractor);
  const hcCurrent = currentDocs((hcDocRows ?? []) as HcDoc[]);

  const scheduled = (schedRows ?? []) as ScheduledRow[];
  const items: ObligationItem[] = [];

  for (const o of scheduled) {
    if (!o.active) continue;
    const completions = o.obligation_completions ?? [];
    const due = nextDue(o, completions);
    items.push({
      key: `scheduled:${o.id}`,
      source: 'scheduled',
      title: o.title,
      basis: o.basis ?? KIND_LABEL[o.kind],
      dueOn: due,
      status: dueStatus(due, today),
      href: `/due/${o.id}${q}`,
      obligationId: o.id,
      completed: completions.length,
      lateCount: completions.filter((c) => !onTime(c)).length,
    });
  }

  // A chemical with no current sheet is due now; one whose sheet expires is due on that day.
  for (const line of chemicals.register) {
    if (line.status === 'current') {
      if (!line.reviewDue) continue;
      items.push({
        key: `sds:${line.productId}`, source: 'sds',
        title: `Safety data sheet review — ${line.name}`,
        basis: 'WHS (General) Regs 2022 (WA) reg. 346 · reviewed at least every five years',
        dueOn: line.reviewDue, status: dueStatus(line.reviewDue, today),
        href: `/chemicals/${line.productId}${q}`,
      });
      continue;
    }
    const dueOn = line.status === 'none' || line.status === 'no_file' ? today : line.reviewDue;
    items.push({
      key: `sds:${line.productId}`, source: 'sds',
      title: `${SDS_STATUS_LABEL[line.status]} — ${line.name}`,
      basis: 'WHS (General) Regs 2022 (WA) reg. 346',
      dueOn,
      // No sheet, or none attached, is overdue today rather than due today: it is a
      // breach now, not a deadline to meet.
      status: line.status === 'none' || line.status === 'no_file' ? 'overdue' : dueStatus(dueOn, today),
      href: `/chemicals/${line.productId}${q}`,
    });
  }

  // Tickets for the people on this job's crew list.
  const crew = new Set(((crewRows ?? []) as Array<{ name: string }>).map((c) => normaliseName(c.name)));
  for (const t of (ticketRows ?? []) as Array<{ id: string; person_name: string; ticket_type: string; expires_on: string }>) {
    if (!crew.has(normaliseName(t.person_name))) continue;
    const label = (TICKET_LABEL as Record<string, string>)[t.ticket_type as TicketType] ?? t.ticket_type.replace(/_/g, ' ');
    const status = dueStatus(t.expires_on, today);
    // A ticket two years off is not an obligation anyone needs to look at yet.
    if (status === 'upcoming') continue;
    items.push({
      key: `ticket:${t.id}`, source: 'ticket',
      title: `${label} — ${t.person_name}`,
      basis: 'ISO 45001 cl. 7.2 · WHS (General) Regs 2022 (WA) reg. 85 for high risk work',
      dueOn: t.expires_on, status,
      href: `/training${q}`,
    });
  }

  // Notifiable incidents: telling WorkSafe is due the moment the business is aware, and written
  // notice 48 hours after WorkSafe asks for it (WHS Act 2020 (WA) s. 38). Read off the events.
  const byIncident = new Map<string, { seq: number; notifiable: boolean; events: RegulatorEvent[] }>();
  for (const i of (notifiableRows ?? []) as Array<{ id: string; seq: number; notifiable: boolean }>) {
    byIncident.set(i.id, { seq: i.seq, notifiable: i.notifiable, events: [] });
  }
  for (const e of (regRows ?? []) as Array<RegulatorEvent & { incident: { id: string; seq: number; notifiable: boolean } | Array<{ id: string; seq: number; notifiable: boolean }> }>) {
    const inc = Array.isArray(e.incident) ? e.incident[0] : e.incident;
    if (!inc) continue;
    const entry = byIncident.get(inc.id) ?? { seq: inc.seq, notifiable: inc.notifiable, events: [] };
    entry.events.push({ id: e.id, kind: e.kind, happened_at: e.happened_at, method: e.method, person_name: e.person_name, detail: e.detail });
    byIncident.set(inc.id, entry);
  }
  const nowIso = new Date().toISOString();
  for (const [id, inc] of byIncident) {
    const st = regulatorState(inc.notifiable, inc.events, nowIso);
    if (!st.applies) continue;
    const ref = incidentRef(inc.seq);
    if (!st.notifiedAt) {
      items.push({
        key: `incident-notify:${id}`, source: 'incident',
        title: `Notify WorkSafe WA — ${ref}`,
        basis: 'WHS Act 2020 (WA) s. 38 · immediately after becoming aware · 1800 678 198',
        dueOn: st.becameAwareAt ? perthDay(st.becameAwareAt) : today, status: 'overdue',
        href: `/incidents/${id}`,
      });
    }
    if (st.writtenNoticeDueAt && !st.writtenNoticeGivenAt) {
      const dueDay = perthDay(st.writtenNoticeDueAt);
      items.push({
        key: `incident-written:${id}`, source: 'incident',
        title: `Written notice to WorkSafe WA — ${ref}`,
        basis: 'WHS Act 2020 (WA) s. 38(4)(b) · within 48 hours of the requirement',
        dueOn: dueDay, status: st.writtenNoticeOverdue ? 'overdue' : 'due_soon',
        href: `/incidents/${id}`,
      });
    }
  }

  // The emergency plan: one per workplace is the law, and its procedures are tested at the
  // frequency the plan itself states (WHS (General) Regs 2022 (WA) reg. 43; ISO 45001 cl. 8.2).
  // Under a head contractor, their site emergency plan received and on file answers for the workplace's plan.
  if (!emergency.current && !(subcontract && hcCurrent.has('emergency_plan'))) {
    items.push({
      key: 'emergency-plan', source: 'emergency',
      title: subcontract ? `Emergency plan for this workplace — ${hcName}'s copy, or your own` : 'Emergency plan for this workplace',
      basis: subcontract ? 'WHS (General) Regs 2022 (WA) reg. 43 · on a head contractor\'s site, record their plan under Construction' : 'WHS (General) Regs 2022 (WA) reg. 43 · one plan for each workplace',
      dueOn: today, status: 'overdue', href: `/emergency${q}`,
    });
  } else if (emergency.current && emergency.nextDrillDue) {
    items.push({
      key: 'emergency-drill', source: 'emergency',
      title: 'Emergency procedures tested — a drill',
      basis: `WHS (General) Regs 2022 (WA) reg. 43(1)(b) · ISO 45001 cl. 8.2 · every ${emergency.current.test_every_months} months, per the plan`,
      dueOn: emergency.nextDrillDue, status: dueStatus(emergency.nextDrillDue, today), href: `/emergency${q}`,
    });
  }

  // Plant on this job: its reg. 213 inspection and, where it must be registered, its registration (s. 42).
  type PlantRow = { id: string; name: string; active: boolean; inspection_basis: InspectionBasis | null; inspection_interval_months: number | null; registration_required: boolean; registration_no: string | null; registration_expires_on: string | null; plant_maintenance_records: Array<{ kind: RecordKind; done_on: string; next_due_on: string | null; outcome: Outcome | null }> | null };
  for (const row of (plantRows ?? []) as Array<{ plant: PlantRow | PlantRow[] }>) {
    const p = Array.isArray(row.plant) ? row.plant[0] : row.plant;
    if (!p || !p.active) continue;
    const href = `/plant/machine/${p.id}${q}`;
    const insp = nextInspection(p, p.plant_maintenance_records ?? []);
    if (insp.state === 'never_inspected') {
      items.push({ key: `plant-insp:${p.id}`, source: 'plant', title: `Inspection — ${p.name} (none on record)`, basis: 'WHS (General) Regs 2022 (WA) reg. 213 · by a competent person', dueOn: today, status: 'overdue', href });
    } else if (insp.state === 'scheduled') {
      items.push({ key: `plant-insp:${p.id}`, source: 'plant', title: `Inspection — ${p.name}`, basis: 'WHS (General) Regs 2022 (WA) reg. 213 · by a competent person', dueOn: insp.due, status: dueStatus(insp.due, today), href });
    }
    const reg = registrationStatus(p, today);
    if (reg === 'missing' || reg === 'expired') {
      items.push({ key: `plant-reg:${p.id}`, source: 'plant', title: `${REGISTRATION_LABEL[reg]} — ${p.name}`, basis: 'WHS Act 2020 (WA) s. 42 · may not be used until registered', dueOn: p.registration_expires_on ?? today, status: 'overdue', href });
    } else if (p.registration_required && p.registration_expires_on) {
      items.push({ key: `plant-reg:${p.id}`, source: 'plant', title: `Registration renewal — ${p.name}`, basis: 'WHS Act 2020 (WA) s. 42', dueOn: p.registration_expires_on, status: dueStatus(p.registration_expires_on, today), href });
    }
  }

  // Construction work (WHS (General) Regs 2022 (WA) Chapter 6).
  if (pcRow?.is_principal_contractor && (whsPlanRows ?? []).length === 0) {
    items.push({ key: 'whs-plan', source: 'construction', title: 'WHS management plan — you are principal contractor', basis: 'WHS (General) Regs 2022 (WA) reg. 309 · written before work starts', dueOn: today, status: 'overdue', href: `/construction${q}` });
  }
  const noCard = withoutWhiteCard(((crewRows ?? []) as Array<{ name: string }>).map((c) => c.name), (whiteCards ?? []) as Array<{ person_name: string; ticket_type: string; active: boolean; expires_on: string | null }>, today);
  if (noCard.length > 0) {
    items.push({ key: 'white-cards', source: 'construction', title: `No white card recorded — ${noCard.length === 1 ? noCard[0] : `${noCard.length} on the crew list`}`, basis: 'WHS (General) Regs 2022 (WA) reg. 317 · general construction induction', dueOn: today, status: 'overdue', href: `/construction${q}` });
  }

  // Quality: the contract's NCR reporting clock, NCRs to close, hold points waiting on a release, calibration.
  const clockHours = (pcRow as { ncr_report_hours?: number | null } | null)?.ncr_report_hours ?? null;
  const nowForNcr = new Date().toISOString();
  for (const n of (ncrRows ?? []) as Array<{ id: string; seq: number; status: string; detected_at: string; reported_to_principal_at: string | null }>) {
    const href = `/quality/ncr/${n.id}${q}`;
    const clock = ncrReportState(n.detected_at, n.reported_to_principal_at, clockHours, nowForNcr);
    if (clock.state === 'due' || clock.state === 'overdue') {
      items.push({ key: `ncr-report:${n.id}`, source: 'quality', title: `Report ${ncrRef(n.seq)} to the principal`, basis: `This job's contract: within ${clockHours} hours of detection`, dueOn: perthDay(clock.dueAt!), status: clock.state === 'overdue' ? 'overdue' : 'due_soon', href });
    }
    items.push({ key: `ncr-close:${n.id}`, source: 'quality', title: `${ncrRef(n.seq)} — ${n.status === 'open' ? 'disposition to approve' : 'to close out'}`, basis: 'ISO 9001 cl. 8.7 · 10.2', dueOn: perthDay(n.detected_at), status: 'due_soon', href });
  }
  type LotRow = { id: string; seq: number; description: string; itp: { itp_points: Array<{ id: string; seq: number; inspection_test: string; point_type: PointType; uses_calibrated_equipment: boolean }> } | Array<{ itp_points: Array<{ id: string; seq: number; inspection_test: string; point_type: PointType; uses_calibrated_equipment: boolean }> }>; lot_checks: Array<{ itp_point_id: string; result: Result; created_at: string }>; hold_point_releases: Array<{ itp_point_id: string }> };
  for (const lot of (openLots ?? []) as LotRow[]) {
    const itp = Array.isArray(lot.itp) ? lot.itp[0] : lot.itp;
    const waiting = holdsAwaitingRelease(itp?.itp_points ?? [], lot.lot_checks ?? [], new Set((lot.hold_point_releases ?? []).map((r) => r.itp_point_id)));
    for (const pt of waiting) {
      items.push({ key: `hold:${lot.id}:${pt.id}`, source: 'quality', title: `Hold point awaiting release — ${lotRef(lot.seq)} point ${pt.seq}, ${pt.inspection_test}`, basis: 'Work beyond a hold point stops until it is released', dueOn: today, status: 'due_soon', href: `/quality/lot/${lot.id}${q}` });
    }
  }
  for (const eq of (equipRows ?? []) as Array<{ id: string; name: string; equipment_calibrations: Array<{ calibrated_on: string; due_on: string; certificate_no: string }> }>) {
    const cal = calibrationStatus(eq.equipment_calibrations ?? [], today);
    if (cal.status === 'current') continue;
    items.push({ key: `cal:${eq.id}`, source: 'quality', title: `${CALIBRATION_LABEL[cal.status]} — ${eq.name}`, basis: 'ISO 9001 cl. 7.1.5', dueOn: cal.latest?.due_on ?? today, status: cal.status === 'due_soon' ? 'due_soon' : 'overdue', href: `/quality/equipment${q}` });
  }

  // Actions from issued audits and reviews, until they are done (ISO cl. 9.2, 9.3; Spec 201 cl. 201.13).
  type AuditRef = { id: string; audit_date: string };
  for (const fnd of (findingRows ?? []) as Array<{ id: string; seq: number; action: string; due_on: string | null; audit: AuditRef | AuditRef[] }>) {
    const au = Array.isArray(fnd.audit) ? fnd.audit[0] : fnd.audit;
    if (!au) continue;
    const dueOn = fnd.due_on ?? au.audit_date;
    items.push({ key: `finding:${fnd.id}`, source: 'audits', title: `Audit action — ${fnd.action}`, basis: `From the internal audit of ${au.audit_date.slice(8, 10)}/${au.audit_date.slice(5, 7)}/${au.audit_date.slice(0, 4)}, finding ${fnd.seq}`, dueOn, status: fnd.due_on ? dueStatus(fnd.due_on, today) : 'due_soon', href: `/audits/audit/${au.id}${q}` });
  }
  type ReviewRef = { id: string; held_on: string };
  for (const ra of (reviewActionRows ?? []) as Array<{ id: string; action: string; due_on: string | null; review: ReviewRef | ReviewRef[] }>) {
    const rv = Array.isArray(ra.review) ? ra.review[0] : ra.review;
    if (!rv) continue;
    items.push({ key: `review-action:${ra.id}`, source: 'audits', title: `Management review action — ${ra.action}`, basis: 'Carried forward until closed out', dueOn: ra.due_on ?? rv.held_on, status: ra.due_on ? dueStatus(ra.due_on, today) : 'due_soon', href: `/audits/review/${rv.id}${q}` });
  }

  // Asbestos (WHS (General) Regs 2022 (WA) regs 425, 429): a plan where it is present, its five-yearly review, the crew briefed.
  const asb = registerInForce((asbestosRows ?? []) as Array<{ id: string; register_date: string; superseded_by: string | null; asbestos_present: boolean; plan_date: string | null; plan_file_path: string | null; asbestos_acknowledgements: Array<{ person_name: string }> }>);
  if (asb && asb.asbestos_present) {
    const href = `/asbestos${q}`;
    if (!asb.plan_file_path) {
      items.push({ key: 'asbestos-plan', source: 'asbestos', title: 'Asbestos management plan — asbestos is present', basis: 'WHS (General) Regs 2022 (WA) reg. 429', dueOn: today, status: 'overdue', href });
    } else {
      const review = planReviewDue(asb);
      if (review) items.push({ key: 'asbestos-plan-review', source: 'asbestos', title: 'Asbestos management plan review', basis: 'WHS (General) Regs 2022 (WA) reg. 429 · at least every five years', dueOn: review, status: dueStatus(review, today), href });
    }
    const unbriefed = notBriefed(((crewRows ?? []) as Array<{ name: string }>).map((c) => c.name), (asb.asbestos_acknowledgements ?? []).map((a) => a.person_name));
    if (unbriefed.length > 0) {
      items.push({ key: 'asbestos-brief', source: 'asbestos', title: `Brief the crew on the asbestos register — ${unbriefed.length === 1 ? unbriefed[0] : `${unbriefed.length} not yet briefed`}`, basis: 'WHS (General) Regs 2022 (WA) reg. 425 · register readily accessible to workers', dueOn: today, status: 'due_soon', href });
    }
  }

  // Health monitoring (Part 7.1 Div 6, Part 7.2): counted per programme, never a name — this list is not confidential.
  type HealthRow = { program_id: string; person_name: string; monitored_on: string; next_due_on: string | null; program: { hazard: string } | Array<{ hazard: string }> };
  const healthList = (healthRows ?? []) as HealthRow[];
  const hazardOf = new Map(healthList.map((h) => [h.program_id, (Array.isArray(h.program) ? h.program[0] : h.program)?.hazard ?? 'Health monitoring']));
  for (const due of programmesDue(healthList, today)) {
    const n = due.overdue + due.dueSoon;
    items.push({ key: `health:${due.programId}`, source: 'health', title: `Health monitoring — ${hazardOf.get(due.programId)}: ${n} ${n === 1 ? 'person' : 'people'} due`, basis: 'WHS (General) Regs 2022 (WA) Part 7.1 Div 6 · names are on the confidential record', dueOn: due.earliestDue ?? today, status: due.overdue > 0 ? 'overdue' : 'due_soon', href: `/health${q}` });
  }

  if (subcontract) {
    const hcHref = `/construction${q}`;
    const hours = job?.head_contractor_incident_hours ?? null;
    const nowMs = new Date().toISOString();
    const dayOf = (iso: string) => new Date(Date.parse(iso) + 8 * 3_600_000).toISOString().slice(0, 10);
    for (const inc of (subIncidents ?? []) as Array<{ id: string; seq: number; occurred_at: string; incident_notices: IncidentNotice[] }>) {
      const st = noticeState(inc.occurred_at, inc.incident_notices ?? [], hours, nowMs);
      if (st.toldAt) continue;
      items.push({ key: `hc-notice:${inc.id}`, source: 'incident', title: `Tell ${hcName} — ${incidentRef(inc.seq)}`, basis: hours ? `Their rules: within ${hours} hour${hours === 1 ? '' : 's'}` : 'Reporting up to the head contractor', dueOn: st.dueAt ? dayOf(st.dueAt) : dayOf(inc.occurred_at), status: st.overdue || !st.dueAt ? 'overdue' : 'due_soon', href: `/incidents/${inc.id}` });
    }
    for (const kind of HC_DOC_EXPECTED) {
      if (hcCurrent.has(kind)) continue;
      items.push({ key: `hc-doc:${kind}`, source: 'construction', title: `${hcName}'s ${HC_DOC_LABEL[kind].toLowerCase()} — get a copy`, basis: kind === 'whs_management_plan' ? 'WHS (General) Regs 2022 (WA) regs 309–311 · the principal contractor\'s plan, made available to the businesses on site' : 'WHS (General) Regs 2022 (WA) reg. 43 · the site\'s plan', dueOn: today, status: 'due_soon', href: hcHref });
    }
    for (const sw of (swmsRows ?? []) as Array<{ id: string; title: string; version: number; swms_reviews: SwmsReview[] }>) {
      const { status, latest } = swmsReviewStatus(sw.swms_reviews ?? []);
      if (status === 'accepted') continue;
      const title = status === 'returned' ? `SWMS returned by ${hcName} — ${sw.title}` : status === 'with_them' ? `SWMS awaiting ${hcName}'s acceptance — ${sw.title}` : `Submit SWMS to ${hcName} — ${sw.title}`;
      items.push({ key: `hc-swms:${sw.id}`, source: 'construction', title, basis: 'WHS (General) Regs 2022 (WA) reg. 312 · the principal contractor collects SWMS before the work', dueOn: latest?.happened_on ?? today, status: status === 'with_them' ? 'due_soon' : 'overdue', href: `/swms/${sw.id}` });
    }
  }

  // Environment (README R73): aspects identified for the job, the environmental incident trail,
  // checks after heavy rain, and actions from issued evaluations of compliance.
  const envHref = `/environment${q}`;
  if ((envApplies ?? []).length === 0) {
    items.push({ key: 'env-aspects', source: 'environment', title: 'Identify the environmental aspects that apply to this job', basis: 'ISO 14001 cl. 6.1.2', dueOn: today, status: 'due_soon', href: `${envHref}#aspects` });
  }
  const settingsRow = envSettings as { env_report_hours_serious: number | null; env_report_hours_minor: number | null; env_investigation_days: number | null; env_rain_inspection_mm: number | string | null } | null;
  const clocks = { seriousHours: settingsRow?.env_report_hours_serious ?? null, minorHours: settingsRow?.env_report_hours_minor ?? null, investigationDays: settingsRow?.env_investigation_days ?? null };
  const envNow = new Date().toISOString();
  const perth = (iso: string) => new Date(Date.parse(iso) + 8 * 3_600_000).toISOString().slice(0, 10);
  for (const inc of (envIncidents ?? []) as Array<{ id: string; seq: number; occurred_at: string; incident_environment_events: EnvEvent[] }>) {
    const st = envIncidentState(inc.occurred_at, inc.incident_environment_events ?? [], clocks, envNow);
    const href = `/incidents/${inc.id}`;
    if (st.dwerNotifiable && !st.dwerWrittenAt) {
      items.push({ key: `env-dwer:${inc.id}`, source: 'environment', title: `Written notice to DWER — ${incidentRef(inc.seq)}`, basis: 'EP Act 1986 (WA) s. 72 · as soon as practicable; a phone call alone does not meet it', dueOn: today, status: 'overdue', href });
    }
    if (st.reportDueAt && !st.reportGivenAt) {
      items.push({ key: `env-report:${inc.id}`, source: 'environment', title: `Environmental incident report — ${incidentRef(inc.seq)}`, basis: 'The head contractor’s or contract’s deadline (e.g. Main Roads WA Spec 204 cl. 204.28)', dueOn: perth(st.reportDueAt), status: st.reportOverdue ? 'overdue' : 'due_soon', href });
    }
    if (st.investigationDueAt && !st.investigationGivenAt) {
      items.push({ key: `env-investigation:${inc.id}`, source: 'environment', title: `Investigation report, Serious incident — ${incidentRef(inc.seq)}`, basis: 'The head contractor’s or contract’s deadline (e.g. Main Roads WA Spec 204 cl. 204.28)', dueOn: perth(st.investigationDueAt), status: st.investigationOverdue ? 'overdue' : dueStatus(perth(st.investigationDueAt), today), href });
    }
    if (!st.severity) {
      items.push({ key: `env-assess:${inc.id}`, source: 'environment', title: `Assess the environmental incident's severity — ${incidentRef(inc.seq)}`, basis: 'Starts the contract reporting clock', dueOn: perth(inc.occurred_at), status: 'overdue', href });
    }
  }
  const rain = rainPrompts(
    ((envWeather ?? []) as Array<{ day: string; rainfall_mm: number | string | null }>).map((w) => ({ day: w.day, rainfall_mm: w.rainfall_mm == null ? null : Number(w.rainfall_mm) })),
    ((envChecks ?? []) as Array<{ inspection_date: string }>).map((c) => c.inspection_date),
    settingsRow?.env_rain_inspection_mm == null ? null : Number(settingsRow.env_rain_inspection_mm),
    today,
  );
  for (const r of rain) {
    items.push({ key: `env-rain:${r.day}`, source: 'environment', title: `Environmental check after ${r.rainfallMm} mm of rain`, basis: 'ISO 14001 cl. 8.1 · rain from 9 am on the day, by the Bureau; the job sets the trigger', dueOn: r.dueOn, status: dueStatus(r.dueOn, today), href: `/inspections${q}` });
  }
  type EvalRef = { id: string; evaluated_on: string };
  for (const a of (envActions ?? []) as Array<{ id: string; action: string; due_on: string | null; evaluation: EvalRef | EvalRef[] }>) {
    const ev = Array.isArray(a.evaluation) ? a.evaluation[0] : a.evaluation;
    if (!ev) continue;
    items.push({ key: `env-action:${a.id}`, source: 'environment', title: `Compliance action — ${a.action}`, basis: `From the evaluation of compliance of ${ev.evaluated_on.slice(8, 10)}/${ev.evaluated_on.slice(5, 7)}/${ev.evaluated_on.slice(0, 4)}`, dueOn: a.due_on ?? ev.evaluated_on, status: a.due_on ? dueStatus(a.due_on, today) : 'due_soon', href: `/environment/evaluation/${ev.id}${q}` });
  }

  const sorted = sortItems(items);
  return { items: sorted, summary: summarise(sorted), scheduled };
}
