import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, canRunTalks } from '@/lib/auth';
import { canManageRegisters } from '@/lib/roles';
import { BrandMark } from '@/components/brand-mark';
import { perthToday } from '@/lib/push/decide';
import { OrderScreen, type OrderView } from './order-screen';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Order · KBS Daily Diary' };

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { userId, memberships } = await requireUser();
  const supabase = await createClient();
  const { data: r } = await supabase
    .from('orders')
    .select(`*, project:projects!inner(name),
      raiser:profiles!orders_raised_by_profiles_fkey(full_name, email),
      order_updates(id, body, created_at, author:profiles!order_updates_created_by_profiles_fkey(full_name, email))`)
    .eq('id', id)
    .maybeSingle();
  if (!r) notFound();
  const membership = memberships.find((m) => m.project_id === r.project_id);
  const role = membership?.role ?? 'pm';
  const project = Array.isArray(r.project) ? r.project[0] : r.project;
  const who = (p: unknown) => { const x = (Array.isArray(p) ? p[0] : p) as { full_name?: string | null; email?: string | null } | null; return x?.full_name ?? x?.email ?? '—'; };
  const view: OrderView = {
    id: r.id, projectId: r.project_id, seq: r.seq, kind: r.kind, status: r.status, item: r.item, quantity: r.quantity, plant: r.plant,
    needed_by: r.needed_by, urgent: r.urgent, notes: r.notes, photo_urls: r.photo_urls ?? [], raised_by: r.raised_by, raised_by_name: who(r.raiser),
    raised_on_device_at: r.raised_on_device_at, ordered_at: r.ordered_at, supplier: r.supplier, order_ref: r.order_ref,
    done_at: r.done_at, done_note: r.done_note, cancelled_at: r.cancelled_at, cancel_reason: r.cancel_reason,
    updates: ((r.order_updates ?? []) as Array<{ id: string; body: string; created_at: string; author: unknown }>)
      .map((u) => ({ id: u.id, body: u.body, created_at: u.created_at, by: who(u.author) }))
      .sort((a, b) => a.created_at.localeCompare(b.created_at)),
  };
  return (
    <main className="sheet">
      <p className="label"><BrandMark size={18} /> {project.name}</p>
      <OrderScreen order={view} canProgress={canRunTalks(role) || canManageRegisters(role)} userId={userId} today={perthToday()} />
    </main>
  );
}
