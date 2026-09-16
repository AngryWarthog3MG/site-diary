import type { SupabaseClient } from '@supabase/supabase-js';
import { TICKET_LABEL, normaliseName, type TicketType } from '@/lib/crew/tickets';
import { loadChemicals } from '@/lib/chemicals/load';
import { SDS_STATUS_LABEL } from '@/lib/chemicals/model';
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
  const [{ data: schedRows }, chemicals, { data: crewRows }, { data: ticketRows }] = await Promise.all([
    supabase
      .from('obligations')
      .select('id, project_id, kind, title, basis, interval_months, first_due_on, active, obligation_completions(id, due_on, done_on, evidence_note, evidence_ref, created_at, done_by)')
      .eq('org_id', orgId)
      .or(`project_id.eq.${projectId},project_id.is.null`)
      .order('first_due_on'),
    loadChemicals(supabase, projectId, orgId, today),
    supabase.from('crew').select('name').eq('project_id', projectId).eq('active', true),
    supabase.from('crew_tickets').select('id, person_name, ticket_type, expires_on, active').eq('org_id', orgId).eq('active', true).not('expires_on', 'is', null),
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

  const sorted = sortItems(items);
  return { items: sorted, summary: summarise(sorted), scheduled };
}
