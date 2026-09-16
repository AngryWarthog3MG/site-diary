import Link from 'next/link';
import { BrandMark } from '@/components/brand-mark';
import { SignOutButton } from '@/components/sign-out-button';
import { FirstRun } from '@/components/first-run';
import { createClient } from '@/lib/supabase/server';
import { perthToday } from '@/lib/push/decide';
import { fmtDate } from '@/lib/pdf/dates';
import { normaliseName } from '@/lib/crew/tickets';
import { eventClock, hoursOnSite, type SignInRow } from '@/lib/signin/register';
import type { Membership } from '@/lib/auth';
import { loadCurrentPlan } from '@/lib/emergency/load';

/**
 * The labourer's opening page: are they signed in right now, and the two
 * buttons. No diary, no figures, no heading bar — the role has two doors and
 * this page is those two doors (README R57). The sign-in state is read from
 * today's register by name, so a supervisor signing them in at the gate shows
 * here too.
 */
export async function LabourerHome({ current, name }: { current: Membership; name: string }) {
  const supabase = await createClient();
  const today = perthToday();
  const planPromise = loadCurrentPlan(supabase, current.project_id);
  const { data } = await supabase
    .from('site_signins')
    .select('id, person_name, company, person_kind, inducted, signed_in_at, signed_in_on_device_at, signed_out_at, signed_out_on_device_at')
    .eq('project_id', current.project_id)
    .eq('signin_date', today)
    .order('signed_in_on_device_at');
  const mine = ((data ?? []) as SignInRow[]).filter((r) => normaliseName(r.person_name) === normaliseName(name));
  const open = mine.find((r) => r.signed_out_at == null) ?? null;
  const done = mine.filter((r) => r.signed_out_at != null);
  const q = `?project=${current.project_id}`;
  const plan = await planPromise;

  return (
    <main className="app-shell home-shell dash labhome">
      <header className="dash-head">
        <div className="dash-head__brand">
          <BrandMark size={34} />
          <div>
            <p className="dash-head__app">KBS Daily Diary</p>
            <p className="dash-head__job">{current.project.name}</p>
          </div>
        </div>
        <div className="dash-head__who">
          <p className="dash-head__name">{name}</p>
          <div className="dash-head__tools"><SignOutButton /></div>
        </div>
      </header>
      <FirstRun role={current.role} />

      <section className={`labhome__status${open ? ' labhome__status--in' : ''}`}>
        <p className="label">{fmtDate(today)}</p>
        {open ? (
          <p className="labhome__line">You are <strong>signed in</strong> since {eventClock(open.signed_in_on_device_at, open.signed_in_at)}.</p>
        ) : done.length > 0 ? (
          <p className="labhome__line">You signed out at {eventClock(done[done.length - 1].signed_out_on_device_at, done[done.length - 1].signed_out_at)}{hoursOnSite(done[done.length - 1]) != null ? ` · ${hoursOnSite(done[done.length - 1])} h today` : ''}.</p>
        ) : (
          <p className="labhome__line">You are <strong>not signed in</strong> yet today.</p>
        )}
      </section>

      <div className="labhome__btns">
        <Link className="labhome__btn" href={`/signin${q}`}>
          <span className="labhome__icon" aria-hidden>{open ? '⇤' : '⇥'}</span>
          <span>{open ? 'Sign out' : 'Sign in'}</span>
          <span className="labhome__hint">{open ? 'When you leave the site' : 'When you arrive at the site'}</span>
        </Link>
        <Link className="labhome__btn labhome__btn--warn" href={`/incidents/new${q}`}>
          <span className="labhome__icon" aria-hidden>⚠</span>
          <span>Report a hazard</span>
          <span className="labhome__hint">Something unsafe, a near miss, someone hurt</span>
        </Link>
      </div>
      <section className="labhome__emerg">
        <p className="label">In an emergency</p>
        <a className="emerg__call" href="tel:000">Call <strong>000</strong></a>
        {plan ? (
          <p className="labhome__muster">Muster at <strong>{plan.muster_point}</strong>{plan.nearest_hospital ? <><br /><span className="caption">Nearest hospital: {plan.nearest_hospital}</span></> : null}</p>
        ) : (
          <p className="caption">No emergency plan recorded for this site yet — ask your supervisor where to muster.</p>
        )}
        <Link href={`/emergency${q}`}>The whole emergency plan</Link>
      </section>
      <p className="labhome__more"><Link href={`/chemicals${q}`}>Chemicals on this site</Link> · <Link href={`/incidents${q}`}>Hazards reported on this job</Link></p>
    </main>
  );
}
