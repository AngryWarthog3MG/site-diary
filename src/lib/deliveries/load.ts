import type { SupabaseClient } from '@supabase/supabase-js';
import { addDays, calendarItems, monthEnd, monthStart, type CalendarItem, type Delivery, type OrderOnCalendar } from './model';

export interface DeliveriesLoad {
  items: CalendarItem[];
  deliveries: Delivery[];
}

/**
 * The deliveries and the unfinished material orders for a set of jobs around a month (README R127), under the
 * caller's RLS: the month with a week either side so the grid's padding days are filled, plus every booked delivery
 * from a day gone by that was never received or cancelled, because an overdue delivery is the one to see wherever
 * the calendar is open.
 */
export async function loadDeliveries(supabase: SupabaseClient, projectIds: readonly string[], month: string, today: string, codeOf: (projectId: string) => string): Promise<DeliveriesLoad> {
  if (projectIds.length === 0) return { items: [], deliveries: [] };
  const from = addDays(monthStart(month), -7);
  const to = addDays(monthEnd(month), 7);
  const select = 'id, project_id, booked_for, window_text, item, quantity, supplier, order_id, notes, status, moved_from, received_at, received_on_device_at, docket_ref, received_note, cancelled_at, cancel_reason, booked:profiles!deliveries_booked_by_fkey(full_name), received:profiles!deliveries_received_by_fkey(full_name)';
  const [inMonth, overdue, orders] = await Promise.all([
    supabase.from('deliveries').select(select).in('project_id', projectIds).gte('booked_for', from).lte('booked_for', to).order('booked_for').order('created_at'),
    supabase.from('deliveries').select(select).in('project_id', projectIds).eq('status', 'booked').lt('booked_for', today).lt('booked_for', from).order('booked_for'),
    supabase.from('orders').select('id, project_id, seq, item, quantity, supplier, needed_by, status, urgent').in('project_id', projectIds).eq('kind', 'material').in('status', ['open', 'ordered']).not('needed_by', 'is', null),
  ]);
  for (const r of [inMonth, overdue, orders]) if (r.error) throw new Error(`Could not read the deliveries: ${r.error.message}`);
  type Raw = Omit<Delivery, 'booked_by_name' | 'received_by_name'> & { booked: { full_name: string | null } | Array<{ full_name: string | null }> | null; received: { full_name: string | null } | Array<{ full_name: string | null }> | null };
  const name = (v: Raw['booked']) => (Array.isArray(v) ? v[0]?.full_name : v?.full_name) ?? null;
  const seen = new Set<string>();
  const deliveries: Delivery[] = [];
  for (const r of [...((inMonth.data ?? []) as unknown as Raw[]), ...((overdue.data ?? []) as unknown as Raw[])]) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    const { booked, received, ...rest } = r;
    deliveries.push({ ...rest, moved_from: rest.moved_from ?? [], booked_by_name: name(booked), received_by_name: name(received) });
  }
  const ordersOn = ((orders.data ?? []) as OrderOnCalendar[]).filter((o) => o.needed_by);
  return { items: calendarItems(deliveries, ordersOn, today, codeOf), deliveries };
}
