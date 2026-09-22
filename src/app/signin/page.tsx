import { Suspense } from 'react';
import { HomeFoot } from '@/components/home-foot';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject, canRunTalks, canSignIn } from '@/lib/auth';
import { sees } from '@/lib/roles';
import { redirect } from 'next/navigation';
import { BrandMark } from '@/components/brand-mark';
import { fmtDate } from '@/lib/pdf/dates';
import { perthToday } from '@/lib/push/decide';
import { OutboxStatus } from '@/components/outbox-status';
import { normaliseName } from '@/lib/crew/tickets';
import { compliance, normaliseCompany, type DocFacts } from '@/lib/subcontractors/model';
import type { SignInRow } from '@/lib/signin/register';
import { SignInScreen } from './signin-screen';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Site sign-in · Kooboolong IMS' };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function shiftDate(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * The gate. Who is on site right now, who has left, and a tap to sign the
 * next person in. One page per day; past days are the register as it stood.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; date?: string }>;
}) {
  const { userId, email, profile, memberships } = await requireUser();
  const { project, date } = await searchParams;
  const current = resolveProject(memberships, project);
  if (!current) {
    return (
      <main className="sheet">
        <p className="notice gap">You are not on an active project.</p>
      </main>
    );
  }
  if (!sees(current, 'signin')) redirect(`/?project=${current.project_id}`);

  const today = perthToday();
  const day = date && DATE_RE.test(date) ? date : today;
  const supabase = await createClient();
  const [{ data: rows }, { data: crewRows }, { data: inductionRows }, { data: subRows }] = await Promise.all([
    supabase
      .from('site_signins')
      .select('id, person_name, company, person_kind, inducted, signed_in_at, signed_in_on_device_at, signed_out_at, signed_out_on_device_at, signed_in_by, self_signed, contact')
      .eq('project_id', current.project_id)
      .eq('signin_date', day)
      .order('signed_in_on_device_at'),
    supabase.from('crew').select('name').eq('project_id', current.project_id).eq('active', true).order('sort_order').order('name'),
    supabase.from('crew_inductions').select('person_name').eq('project_id', current.project_id),
    supabase.from('subcontractors').select('name, active, subcontractor_documents(kind, expires_on, active)').eq('org_id', current.project.org.id).eq('active', true),
  ]);
  const companies = ((subRows ?? []) as Array<{ name: string; subcontractor_documents: DocFacts[] }>)
    .map((s) => ({ name: s.name, key: normaliseCompany(s.name), verdict: compliance(s.subcontractor_documents ?? [], today).verdict }));

  const q = `?project=${current.project_id}`;
  return (
    <main className="sheet">
      <Suspense fallback={null}>
        <HomeFoot at="top" />
      </Suspense>
      <p className="label">
        <BrandMark size={18} /> {current.project.name}
      </p>
      <h1 className="page-title">Site sign-in</h1>
      {current.role === 'labourer' ? (
        <p className="page-subtitle">Tap when you arrive and when you leave. That is your time for the day.</p>
      ) : (
        <p className="page-subtitle">
          Everyone on site, in and out at the gate. The list of who is here is the roll call; the
          day&rsquo;s register is the attendance record.
        </p>
      )}
      {canRunTalks(current.role) && current.role !== 'leading_hand' && (
        <Link className="button button--quiet" href={`/signin/gate${q}`}>Gate code and sign</Link>
      )}
      <nav className="daynav" aria-label="Other days">
        <Link className="daynav__link" href={`/signin${q}&date=${shiftDate(day, -1)}`} rel="prev">
          <span aria-hidden="true">‹</span> {fmtDate(shiftDate(day, -1)).slice(0, 5)}
        </Link>
        <span className="daynav__today mono">{day === today ? `Today · ${fmtDate(day)}` : fmtDate(day)}</span>
        {day < today ? (
          <Link className="daynav__link daynav__link--next" href={`/signin${q}&date=${shiftDate(day, 1)}`} rel="next">
            {fmtDate(shiftDate(day, 1)).slice(0, 5)} <span aria-hidden="true">›</span>
          </Link>
        ) : (
          <span className="daynav__link daynav__link--none daynav__link--next">Today</span>
        )}
      </nav>
      <OutboxStatus />
      <SignInScreen
        projectId={current.project_id}
        date={day}
        isToday={day === today}
        rows={(rows ?? []) as Array<SignInRow & { signed_in_by: string | null; self_signed: boolean; contact: string | null }>}
        crew={(crewRows ?? []).map((c) => String(c.name))}
        inducted={(inductionRows ?? []).map((r) => normaliseName(String(r.person_name)))}
        canRun={canSignIn(current.role)}
        userId={userId}
        companies={companies}
        self={profile?.full_name ?? email ?? null}
        selfOnly={current.role === 'labourer'}
      />
    </main>
  );
}
