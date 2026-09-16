import type { SupabaseClient } from '@supabase/supabase-js';
import { TICKET_LABEL, normaliseName, type TicketType } from '@/lib/crew/tickets';
import { loadChemicals } from '@/lib/chemicals/load';
import { SDS_STATUS_LABEL } from '@/lib/chemicals/model';
import { regulatorState, perthDay, type RegulatorEvent } from '@/lib/incidents/regulator';
import { incidentRef } from '@/lib/incidents/model';
import { loadEmergency } from '@/lib/emergency/load';
import { withoutWhiteCard } from '@/lib/construction/model';
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

export async function loadObligations(
  supabase: SupabaseClient,
  projectId: string,
  orgId: string,
  today: string,
): Promise<ObligationsData> {
  const q = `?project=${projectId}`;
  const [{ data: schedRows }, chemicals, { data: crewRows }, { data: ticketRows }, { data: notifiableRows }, { data: regRows }, emergency, { data: plantRows }, { data: pcRow }, { data: whsPlanRows }, { data: whiteCards }, { data: ncrRows }, { data: openLots }, { data: equipRows }, { data: findingRows }, { data: reviewActionRows }] = await Promise.all([
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
    supabase.from('projects').select('is_principal_contractor, ncr_report_hours').eq('id', projectId).maybeSingle(),
    supabase.from('whs_management_plans').select('id').eq('project_id', projectId).limit(1),
    supabase.from('crew_tickets').select('person_name, ticket_type, active, expires_on').eq('org_id', orgId).eq('ticket_type', 'white_card'),
    supabase.from('ncrs').select('id, seq, status, detected_at, reported_to_principal_at').eq('project_id', projectId).neq('status', 'closed'),
    supabase.from('lots').select('id, seq, description, itp:itps!inner(itp_points(id, seq, inspection_test, point_type, uses_calibrated_equipment)), lot_checks(itp_point_id, result, created_at), hold_point_releases(itp_point_id)').eq('project_id', projectId).eq('status', 'open'),
    supabase.from('measuring_equipment').select('id, name, active, equipment_calibrations(calibrated_on, due_on, certificate_no)').eq('org_id', orgId).eq('active', true),
    supabase.from('audit_findings').select('id, seq, action, due_on, audit:audits!inner(id, org_id, project_id, status, audit_date)').is('done_at', null).not('action', 'is', null).eq('audit.org_id', orgId).eq('audit.status', 'issued').or(`project_id.eq.${projectId},project_id.is.null`, { referencedTable: 'audit' }),
    supabase.from('review_actions').select('id, action, due_on, review:management_reviews!inner(id, org_id, project_id, status, held_on)').is('done_at', null).eq('review.org_id', orgId).eq('review.status', 'issued').or(`project_id.eq.${projectId},project_id.is.null`, { referencedTable: 'review' }),
  ]);

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
  if (!emergency.current) {
    items.push({
      key: 'emergency-plan', source: 'emergency',
      title: 'Emergency plan for this workplace',
      basis: 'WHS (General) Regs 2022 (WA) reg. 43 · one plan for each workplace',
      dueOn: today, status: 'overdue', href: `/emergency${q}`,
    });
  } else if (emergency.nextDrillDue) {
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

  const sorted = sortItems(items);
  return { items: sorted, summary: summarise(sorted), scheduled };
}
