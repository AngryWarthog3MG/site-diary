import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject, guardScreen, canRunTalks } from '@/lib/auth';
import { BrandMark } from '@/components/brand-mark';
import { OutboxStatus } from '@/components/outbox-status';
import { perthToday } from '@/lib/push/decide';
import { loadWateringWeek } from '@/lib/watering/load';
import { DAY_SHORT, addDays, dm, dmy, fmtHours, readWeek, summariseWeek, weekDays, weekOf } from '@/lib/watering/model';
import { WateringScreen } from './watering-screen';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Watering register · Kooboolong IMS' };

/**
 * The watering register (README R190): a week of the job, an area a row and a day a column — how each area was
 * watered and for how many hours, any supplementary watering beside it, a note, and the day's maximum temperature.
 * Recorded a day at a time from the phone; printed a week at a time. A job has one once the office gives it an area.
 */
export default async function WateringPage({ searchParams }: { searchParams: Promise<{ project?: string; week?: string }> }) {
  const { memberships } = await requireUser();
  const params = await searchParams;
  const current = resolveProject(memberships, params.project);
  if (!current) redirect('/');
  guardScreen(current, 'watering');
  const today = perthToday();
  const monday = readWeek(params.week, today);
  const thisMonday = weekOf(today);
  const supabase = await createClient();
  const week = await loadWateringWeek(supabase, current.project_id, monday);
  const office = current.role === 'pm' || current.role === 'admin';
  const p = current.project_id;
  const at = (m: string) => `/watering?project=${p}&week=${m}`;
  const sum = summariseWeek(monday, today, week.entries, week.days);
  const days = weekDays(monday);

  return (
    <main className="sheet sheet--wide">
      <p className="label"><BrandMark size={18} /> {current.project.name}</p>
      <OutboxStatus />
      <h1 className="page-title">Watering register</h1>
      <p className="page-subtitle">
        Each area, each day: how it was watered and for how many hours, any supplementary watering beside it, and the day’s
        maximum temperature. Record a day from the phone; print the week.
      </p>
      {week.areas.length === 0 && !office ? (
        <p className="notice">This job has no watering register. The office starts one by adding the areas that are watered.</p>
      ) : (
        <>
          <nav className="chips" aria-label="Week" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', margin: '1rem 0 0.75rem', alignItems: 'center' }}>
            <Link href={at(addDays(monday, -7))} className="chip chip--link">‹ Week of {dm(addDays(monday, -7))}</Link>
            <span className="chip" aria-current="page" style={{ color: 'var(--ink)' }}>Mon {dmy(monday)} – Sun {dmy(days[6])}</span>
            {monday < thisMonday && <Link href={at(addDays(monday, 7))} className="chip chip--link">Week of {dm(addDays(monday, 7))} ›</Link>}
            {monday !== thisMonday && <Link href={at(thisMonday)} className="chip chip--link">This week</Link>}
          </nav>
          {week.areas.length > 0 && (
            <div className="regs__facts docs__tiles">
              <span className="regs__fact"><span className="regs__fact-label">Hours watered</span><span className="regs__fact-text docs__big">{fmtHours(sum.total)}</span><span className="regs__fact-sub">{sum.supp > 0 ? `${fmtHours(sum.supp)} h of it supplementary` : 'no supplementary watering'}</span></span>
              <span className={`regs__fact${sum.unrecorded.length ? ' regs__fact--bad' : sum.due ? ' regs__fact--ok' : ''}`}><span className="regs__fact-label">Days recorded</span><span className="regs__fact-text docs__big">{sum.recorded} of {sum.due}</span><span className="regs__fact-sub">{sum.unrecorded.length ? `not recorded: ${sum.unrecorded.map((d) => DAY_SHORT[days.indexOf(d)]).join(', ')}` : 'of the days that have come'}</span></span>
              <span className="regs__fact"><span className="regs__fact-label">Hottest day</span><span className="regs__fact-text docs__big">{sum.hottest ? `${sum.hottest.temp.toFixed(1)}°` : '—'}</span><span className="regs__fact-sub">{sum.hottest ? `${DAY_SHORT[days.indexOf(sum.hottest.day)]} ${dm(sum.hottest.day)}` : 'no temperature read yet'}</span></span>
              <span className={`regs__fact${sum.gaps ? ' regs__fact--bad' : ''}`}><span className="regs__fact-label">Hours missing</span><span className="regs__fact-text docs__big">{sum.gaps}</span><span className="regs__fact-sub">watering recorded with no hours beside it</span></span>
            </div>
          )}
          <WateringScreen
            key={monday}
            projectId={p} monday={monday} today={today}
            areas={week.areas} entries={week.entries} days={week.days} closed={week.closed} bureau={week.bureau}
            canRecord={canRunTalks(current.role)} canClose={current.role === 'supervisor' || office} office={office}
          />
        </>
      )}
    </main>
  );
}
