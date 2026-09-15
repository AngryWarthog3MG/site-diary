import type { SupabaseClient } from '@supabase/supabase-js';
import { loadSafety, type SafetyData } from '@/lib/safety/load';
import { perthWindowStart } from '@/lib/safety/window';

/**
 * What the home page's cards show. The safety figures are the dashboard's own
 * loader, so the two screens can never disagree; the home adds the lists a
 * person opens the app to see — what is open, what was just issued.
 */
export interface DashboardData {
  safety: SafetyData;
  /** Reports not yet closed, however old, newest first. */
  openIncidents: Array<{ id: string; seq: number; kind: string; occurred_at: string; status: string; description: string }>;
  /** The company's latest issued document versions, newest first. */
  latestDocuments: Array<{ id: string; title: string; version: number; issued_at: string; summary: string | null }>;
  last30: { reported: number; open: number; closed: number; injuries: number };
  /** Orders still to place or receive, and plant issues still open. */
  orders: { toOrder: number; ordered: number; issues: number; urgent: number };
}

export const OPEN_LIST = 5;
export const DOCS_LIST = 4;

export async function loadDashboard(supabase: SupabaseClient, projectId: string, orgId: string, today: string): Promise<DashboardData> {
  // Perth midnight, so the first morning of the window counts (Codex pass 27).
  const thirtyAgo = perthWindowStart(today, 30);
  const [safety, open, docs, orders] = await Promise.all([
    loadSafety(supabase, projectId, orgId, today),
    supabase.from('incidents').select('id, seq, kind, occurred_at, status, description').eq('project_id', projectId).neq('status', 'closed').order('occurred_at', { ascending: false }).limit(OPEN_LIST + 1),
    supabase.from('document_versions').select('id, version, issued_at, summary, document:controlled_documents!inner(title, org_id, active)').eq('document.org_id', orgId).eq('document.active', true).eq('status', 'current').order('issued_at', { ascending: false }).limit(DOCS_LIST),
    supabase.from('orders').select('kind, status, urgent, needed_by').eq('project_id', projectId).in('status', ['open', 'ordered']),
  ]);
  const orderRows = (orders.data ?? []) as Array<{ kind: 'material' | 'plant_issue'; status: 'open' | 'ordered'; urgent: boolean; needed_by: string | null }>;
  const recent30 = safety.incidents.recent.filter((i) => i.occurred_at >= thirtyAgo);
  return {
    safety,
    openIncidents: (open.data ?? []) as DashboardData['openIncidents'],
    latestDocuments: ((docs.data ?? []) as Array<{ id: string; version: number; issued_at: string; summary: string | null; document: { title: string } | { title: string }[] }>)
      .map((v) => ({ id: v.id, version: v.version, issued_at: v.issued_at, summary: v.summary, title: (Array.isArray(v.document) ? v.document[0] : v.document).title })),
    orders: {
      toOrder: orderRows.filter((o) => o.kind === 'material' && o.status === 'open').length,
      ordered: orderRows.filter((o) => o.kind === 'material' && o.status === 'ordered').length,
      issues: orderRows.filter((o) => o.kind === 'plant_issue').length,
      urgent: orderRows.filter((o) => o.urgent).length,
    },
    last30: {
      reported: recent30.length,
      open: recent30.filter((i) => i.status !== 'closed').length,
      closed: recent30.filter((i) => i.status === 'closed').length,
      injuries: recent30.filter((i) => i.kind === 'injury').length,
    },
  };
}

const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** The day and month a timestamp falls on in Perth, for a date badge. */
export function perthBadge(iso: string): { day: string; mon: string } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Perth', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
  const [, m, d] = parts.split('-');
  return { day: String(Number(d)), mon: MON[Number(m) - 1] };
}
