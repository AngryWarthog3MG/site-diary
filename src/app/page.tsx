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
import { canRunTalks, ROLE_LABEL } from '@/lib/roles';
import { navFor, viewerFor } from '@/lib/nav';
import { SignOutButton } from '@/components/sign-out-button';
import { TodayPanel } from './today-panel';
import { DashboardCards, DashboardSkeleton } from './dashboard-cards';

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
  const current = resolveProject(memberships, projectParam);

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

  const activeJobs = memberships.filter((m) => m.project.active).length;
  const q = `?project=${current.project_id}`;
  const groups = navFor(viewerFor(current.role, activeJobs));
  const talks = canRunTalks(current.role);
  const authors = canAuthorEntries(current.role);

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

      {(talks || authors) && (
        <div className="dash-actions">
          {talks && <Link className="dash-action" href={`/incidents/new${q}`}><span aria-hidden>⚠</span> New hazard</Link>}
          {talks && <Link className="dash-action" href={`/inspections/new${q}`}><span aria-hidden>☑</span> New inspection</Link>}
          {authors && <Link className="dash-action" href={`/permits/new${q}`}><span aria-hidden>▤</span> New permit</Link>}
          {talks && <Link className="dash-action" href={`/prestart/new${q}`}><span aria-hidden>☀</span> New prestart</Link>}
          {talks && <Link className="dash-action" href={`/orders${q}#raise`}><span aria-hidden>▣</span> Order / plant issue</Link>}
        </div>
      )}

      <div className="dash-body">
        <section className="dash-card dash-card--diary">
          <TodayPanel
            projectId={current.project_id}
            canRecord={authors}
            canPrestart={talks}
            roleLabel={ROLE_LABEL[current.role].toLowerCase() === 'project manager' ? 'the project manager' : `the ${ROLE_LABEL[current.role].toLowerCase()}`}
          />
        </section>
        <div className="dash-grid">
          <Suspense fallback={<DashboardSkeleton />}>
            <DashboardCards projectId={current.project_id} orgId={current.project.org.id} role={current.role} />
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
