import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject, guardScreen, canRunTalks } from '@/lib/auth';
import { canAuthorEntries } from '@/lib/roles';
import { BrandMark } from '@/components/brand-mark';
import { OutboxStatus } from '@/components/outbox-status';
import { perthToday } from '@/lib/push/decide';
import { loadDeliveries } from '@/lib/deliveries/load';
import { monthLabel, nextMonth, prevMonth, readMonth, summarise } from '@/lib/deliveries/model';
import { DeliveriesScreen } from './deliveries-screen';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Calendar · Kooboolong IMS' };

/**
 * The deliveries calendar (README R127): what is booked to arrive on this job, day by day, with the material orders
 * waiting beside them — or, for the office, every job at once. Book, move, receive and cancel from the same page.
 */
export default async function DeliveriesPage({ searchParams }: { searchParams: Promise<{ project?: string; month?: string; scope?: string }> }) {
  const { userId, memberships } = await requireUser();
  const params = await searchParams;
  const current = resolveProject(memberships, params.project);
  if (!current) redirect('/');
  guardScreen(current, 'deliveries');
  const today = perthToday();
  const month = readMonth(params.month, today);
  const office = canAuthorEntries(current.role) && current.role !== 'supervisor';
  const wholeCompany = params.scope === 'company' && office;
  const ours = memberships.filter((m) => m.project.org.id === current.project.org.id && m.project.active);
  const jobs = (wholeCompany ? ours : ours.filter((m) => m.project_id === current.project_id))
    .map((m) => ({ id: m.project_id, code: m.project.code, name: m.project.name, canBook: canRunTalks(m.role) }))
    .sort((a, b) => a.code.localeCompare(b.code));
  const codeOf = (id: string) => jobs.find((j) => j.id === id)?.code ?? '?';
  const supabase = await createClient();
  const { items } = await loadDeliveries(supabase, jobs.map((j) => j.id), month, today, codeOf);
  const sum = summarise(items, today, month);
  const p = current.project_id;
  const at = (m: string, scope = wholeCompany) => `/deliveries?project=${p}&month=${m}${scope ? '&scope=company' : ''}`;

  return (
    <main className="sheet sheet--wide">
      <p className="label"><BrandMark size={18} /> {wholeCompany ? current.project.org.name : current.project.name}</p>
      <OutboxStatus />
      <h1 className="page-title">Calendar</h1>
      <p className="page-subtitle">
        Deliveries booked to arrive, day by day, and the material orders still waiting for a day. A delivery booked here shows on
        the job’s home page on the day and on that day’s diary.
      </p>
      {office && (
        <div className="photo-add-pair">
          <Link className={`button ${wholeCompany ? 'button--quiet' : ''}`} href={at(month, false)}>This job</Link>
          <Link className={`button ${wholeCompany ? '' : 'button--quiet'}`} href={at(month, true)}>Every job</Link>
        </div>
      )}
      <nav className="chips" aria-label="Month" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', margin: '1rem 0 0.75rem', alignItems: 'center' }}>
        <Link href={at(prevMonth(month))} className="chip chip--link">‹ {monthLabel(prevMonth(month))}</Link>
        <span className="chip chip--on" aria-current="page">{monthLabel(month)}</span>
        <Link href={at(nextMonth(month))} className="chip chip--link">{monthLabel(nextMonth(month))} ›</Link>
        {month !== today.slice(0, 7) && <Link href={at(today.slice(0, 7))} className="chip chip--link">This month</Link>}
      </nav>
      <div className="regs__facts docs__tiles">
        <span className={`regs__fact${sum.today ? ' regs__fact--ok' : ''}`}><span className="regs__fact-label">Today</span><span className="regs__fact-text docs__big">{sum.today}</span><span className="regs__fact-sub">{sum.tomorrow} tomorrow</span></span>
        <span className="regs__fact"><span className="regs__fact-label">Booked this month</span><span className="regs__fact-text docs__big">{sum.inMonth}</span><span className="regs__fact-sub">{sum.received} received</span></span>
        <span className={`regs__fact${sum.overdue ? ' regs__fact--bad' : ''}`}><span className="regs__fact-label">Overdue</span><span className="regs__fact-text docs__big">{sum.overdue}</span><span className="regs__fact-sub">booked for a day gone by, not received</span></span>
        <span className="regs__fact"><span className="regs__fact-label">Orders waiting</span><span className="regs__fact-text docs__big">{sum.ordersWaiting}</span><span className="regs__fact-sub">with a needed-by day, no delivery booked</span></span>
      </div>
      <DeliveriesScreen
        items={items} jobs={jobs} month={month} today={today} userId={userId}
        defaultJobId={current.project_id} wholeCompany={wholeCompany}
      />
    </main>
  );
}
