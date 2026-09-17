import Link from 'next/link';
import { Suspense } from 'react';
import { BrandMark } from '@/components/brand-mark';
import { RefreshButton } from '@/components/refresh-button';
import { SectionBar } from '@/components/section-bar';
import {
  requireUser,
  resolveProject,
  canAuthorEntries,
} from '@/lib/auth';
import { canRunTalks, canReport, sees, ROLE_LABEL, type Screen } from '@/lib/roles';
import { navFor, viewerFor } from '@/lib/nav';
import { SignOutButton } from '@/components/sign-out-button';
import { TodayPanel } from './today-panel';
import { DashboardCards, DashboardSkeleton } from './dashboard-cards';
import { FirstRun } from '@/components/first-run';
import { LabourerHome } from './labourer-home';

export const dynamic = 'force-dynamic';

/**
 * The opening page, laid out the way the office's compliance systems lay
 * theirs out: the company and the person across the top, a bar of section
 * headings under that (each opens a panel of what is in it), a row of the
 * things you raise most, then the cards — today's diary first, and beside it
 * every figure the office looks for, read from the record. The headings are
 * the same list the drawer and the rail draw (`src/lib/nav.ts`), filtered by
 * the role the server already knows.
 */
export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const { email, profile, memberships } = await requireUser();
  const { project: projectParam } = await searchParams;
  // A job named in the URL that is no longer this account's (a remembered id after access
  // changed, an old link) falls back to the account's own default rather than a dead end.
  const current = resolveProject(memberships, projectParam) ?? (projectParam ? resolveProject(memberships, undefined) : null);

  if (!current) {
    return (
      <main className="app-shell app-shell--narrow">
        <section className="sheet">
        <p className="label"><BrandMark size={20} withName /></p>
        <hr className="rule" />
        <p className="notice gap">
          You are signed in as <strong>{email}</strong>, and that account is not on a
          project yet. If that is the wrong address, sign out and use the right one; if it
          is right, your site admin needs to add you.
        </p>
        <hr className="rule" />
        <SignOutButton />
        </section>
      </main>
    );
  }

  if (current.role === 'labourer') return <LabourerHome current={current} name={profile?.full_name ?? email ?? 'You'} />;

  const activeJobs = memberships.filter((m) => m.project.active).length;
  const q = `?project=${current.project_id}`;
  const groups = navFor(viewerFor(current, activeJobs));
  const talks = canRunTalks(current.role);
  const reports = canReport(current.role);
  const authors = canAuthorEntries(current.role);
  // A quick button is a door like any other: the role must allow it AND the screen must be ticked for this person (README R57).
  const opens = (screen: Screen) => sees(current, screen);

  return (
    <main className="app-shell home-shell dash">
      <header className="dash-head">
        <div className="dash-head__brand">
          <BrandMark size={34} />
          <div>
            <p className="dash-head__app">KBS Daily Diary</p>
            <p className="dash-head__job">{current.project.name} <span className="mono">{current.project.org.code}_{current.project.code}</span></p>
          </div>
        </div>
        <div className="dash-head__who">
          <p className="dash-head__name">{profile?.full_name ?? email}</p>
          <p className="caption">{ROLE_LABEL[current.role]} · {current.project.org.name}</p>
          <div className="dash-head__tools">
            <RefreshButton />
            <SignOutButton />
          </div>
        </div>
      </header>
      <ProjectSwitcher memberships={memberships} currentId={current.project_id} />

      <SectionBar groups={groups} q={q} />
      <FirstRun role={current.role} />

      {((reports && opens('incidents')) || (!talks && reports && opens('signin')) || (talks && (opens('inspections') || opens('prestart') || opens('orders'))) || (authors && opens('permits'))) && (
        <div className="dash-actions">
          {reports && opens('incidents') && <Link className="dash-action" href={`/incidents/new${q}`}><span aria-hidden>⚠</span> New hazard</Link>}
          {!talks && reports && opens('signin') && <Link className="dash-action" href={`/signin${q}`}><span aria-hidden>⇥</span> Sign in / out</Link>}
          {talks && opens('inspections') && <Link className="dash-action" href={`/inspections/new${q}`}><span aria-hidden>☑</span> New inspection</Link>}
          {authors && opens('permits') && <Link className="dash-action" href={`/permits/new${q}`}><span aria-hidden>▤</span> New permit</Link>}
          {talks && opens('prestart') && <Link className="dash-action" href={`/prestart/new${q}`}><span aria-hidden>☀</span> New prestart</Link>}
          {talks && opens('orders') && <Link className="dash-action" href={`/orders${q}#raise`}><span aria-hidden>▣</span> Order / plant issue</Link>}
        </div>
      )}

      <div className="dash-body">
        <section className="dash-card dash-card--diary">
          <TodayPanel
            projectId={current.project_id}
            canRecord={authors}
            canPrestart={talks}
            doors={{ prestart: opens('prestart'), permits: opens('permits'), incidents: opens('incidents'), signin: opens('signin'), plant: opens('plant') }}
            roleLabel={ROLE_LABEL[current.role].toLowerCase() === 'project manager' ? 'the project manager' : `the ${ROLE_LABEL[current.role].toLowerCase()}`}
          />
        </section>
        <div className="dash-grid">
          <Suspense fallback={<DashboardSkeleton />}>
            <DashboardCards projectId={current.project_id} orgId={current.project.org.id} member={current} />
          </Suspense>
        </div>
      </div>
    </main>
  );
}

/**
 * One person, several sites. Shown only when there is actually a choice —
 * a single-project supervisor never sees it.
 */
function ProjectSwitcher({
  memberships,
  currentId,
}: {
  memberships: Awaited<ReturnType<typeof requireUser>>['memberships'];
  currentId: string;
}) {
  const active = memberships.filter((m) => m.project.active);
  if (active.length < 2) return null;

  return (
    <ul className="chips home-switcher">
      {active.map((m) => (
        <li key={m.project_id}>
          <Link
            className={`chip chip--link${m.project_id === currentId ? ' chip--on' : ''}`}
            href={`/?project=${m.project_id}`}
          >
            {m.project.org.code}-{m.project.code}
          </Link>
        </li>
      ))}
    </ul>
  );
}
