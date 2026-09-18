import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject, canRunTalks } from '@/lib/auth';
import { sees } from '@/lib/roles';
import { BrandMark } from '@/components/brand-mark';
import { OutboxStatus } from '@/components/outbox-status';
import { fmtDate, fmtPerthDate } from '@/lib/pdf/dates';
import { perthToday } from '@/lib/push/decide';
import { KIND_LABEL, orderRef, statusLabel, summarise, isFinished, type OrderKind, type OrderStatus } from '@/lib/orders/model';
import { RaiseOrder } from './raise-order';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Orders & plant issues · Kooboolong IMS' };

interface Row {
  id: string; seq: number; kind: OrderKind; status: OrderStatus; item: string; quantity: string | null; plant: string | null;
  needed_by: string | null; urgent: boolean; raised_on_device_at: string; supplier: string | null; done_at: string | null; cancelled_at: string | null;
}

/** The register: what still has to happen at the top, urgent first; what is finished below. */
export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { userId, memberships } = await requireUser();
  const { project } = await searchParams;
  const current = resolveProject(memberships, project);
  if (!current) return <main className="sheet"><p className="notice gap">You are not on an active project.</p></main>;
  if (!sees(current, 'orders')) redirect(`/?project=${current.project_id}`);
  const supabase = await createClient();
  const [{ data }, { data: plant }] = await Promise.all([
    supabase.from('orders')
      .select('id, seq, kind, status, item, quantity, plant, needed_by, urgent, raised_on_device_at, supplier, done_at, cancelled_at')
      .eq('project_id', current.project_id).order('raised_on_device_at', { ascending: false }).limit(300),
    supabase.from('project_plant').select('plant:plant_register!inner(name)').eq('project_id', current.project_id).eq('active', true),
  ]);
  const rows = (data ?? []) as Row[];
  const today = perthToday();
  const s = summarise(rows, today);
  const rank = (r: Row) => (r.urgent ? 0 : 1) * 10 + (r.needed_by && r.needed_by < today ? 0 : 1);
  const live = rows.filter((r) => !isFinished(r.status)).sort((a, b) => rank(a) - rank(b) || (a.needed_by ?? '9999').localeCompare(b.needed_by ?? '9999') || a.raised_on_device_at.localeCompare(b.raised_on_device_at));
  const materials = live.filter((r) => r.kind === 'material');
  const issues = live.filter((r) => r.kind === 'plant_issue');
  const finished = rows.filter((r) => isFinished(r.status)).slice(0, 40);
  const plantNames = (plant ?? []).map((p) => { const r = Array.isArray(p.plant) ? p.plant[0] : p.plant; return String((r as { name: string } | null)?.name ?? ''); }).filter(Boolean);
  const q = `?project=${current.project_id}`;

  const card = (r: Row) => {
    const late = !isFinished(r.status) && r.needed_by != null && r.needed_by < today;
    return (
      <Link key={r.id} href={`/orders/${r.id}${q}`} className={`prestart-row ${isFinished(r.status) ? 'prestart-row--done' : r.urgent || late ? 'prestart-row--open' : ''}`}>
        <span>
          <strong>{r.item}</strong>{r.quantity ? ` · ${r.quantity}` : ''}{r.plant ? ` · ${r.plant}` : ''}{r.urgent && !isFinished(r.status) ? ' · URGENT' : ''}
          <br />
          <span className="caption">
            {orderRef(r.seq)} · {statusLabel(r.kind, r.status)}{r.supplier ? ` · ${r.supplier}` : ''}
            {r.needed_by ? ` · needed by ${fmtDate(r.needed_by)}${late ? ' — LATE' : ''}` : ''} · raised {fmtPerthDate(r.raised_on_device_at)}
          </span>
        </span>
        <span>Open</span>
      </Link>
    );
  };

  return (
    <main className="sheet">
      <p className="label"><BrandMark size={18} /> {current.project.name}</p>
      <h1 className="page-title">Orders &amp; plant issues</h1>
      <p className="page-subtitle">
        Think of it, add it. Diesel, consumables, a part — anything the job needs — and any fault on a machine. It saves
        the moment you tap, with or without signal; the office orders it and marks it received or fixed.
      </p>
      <OutboxStatus />
      <section className="entries-summary" aria-label="Register summary" style={{ marginTop: '1rem' }}>
        <div><p className="label">To order</p><p className={`entries-summary__value mono${s.urgent > 0 ? ' vr-missing' : ''}`}>{s.toOrder}</p></div>
        <div><p className="label">Ordered</p><p className="entries-summary__value mono">{s.ordered}</p></div>
        <div><p className="label">Plant issues</p><p className="entries-summary__value mono">{s.issues}</p></div>
        <div><p className="label">Late</p><p className={`entries-summary__value mono${s.late > 0 ? ' vr-missing' : ''}`}>{s.late}</p></div>
      </section>
      {canRunTalks(current.role) && <RaiseOrder projectId={current.project_id} userId={userId} plant={plantNames} />}
      <hr className="rule" />
      <p className="label">{KIND_LABEL.material}s — to order and ordered</p>
      {materials.length === 0 ? <p className="nil">Nothing to order.</p> : materials.map(card)}
      <p className="label" style={{ marginTop: '1rem' }}>{KIND_LABEL.plant_issue}s — open</p>
      {issues.length === 0 ? <p className="nil">No plant issues open.</p> : issues.map(card)}
      {finished.length > 0 && (<><p className="label" style={{ marginTop: '1rem' }}>Received, fixed or cancelled</p>{finished.map(card)}</>)}
    </main>
  );
}
