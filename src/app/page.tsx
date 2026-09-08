import Link from 'next/link';
import { Suspense } from 'react';
import { AppMenu } from '@/components/app-menu';
import { BrandMark } from '@/components/brand-mark';
import { createClient } from '@/lib/supabase/server';
import {
  requireUser,
  resolveProject,
  canAuthorEntries,
} from '@/lib/auth';
import { canRunTalks, ROLE_LABEL } from '@/lib/roles';
import { SignOutButton } from '@/components/sign-out-button';
import { TodayPanel } from './today-panel';

export const dynamic = 'force-dynamic';

/**
 * Screen 1 (brief §7.1): project header, entry serial, weather, the six
 * required sections with capture status, one large record button, and the
 * last entry's status.
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

  return (
    <main className="app-shell app-shell--narrow home-shell">
      <section className="sheet home-sheet">
        <div className="home-top">
          <p className="label home-top__job">
            <BrandMark size={18} /> {current.project.name}
          </p>
          <Suspense fallback={null}>
            <AppMenu slotId="menu-slot-home" />
          </Suspense>
        </div>
        <div id="menu-slot-home" className="menu-slot" />
        <ProjectSwitcher memberships={memberships} currentId={current.project_id} />

        <TodayPanel
          projectId={current.project_id}
          canRecord={canAuthorEntries(current.role)}
          canPrestart={canRunTalks(current.role)}
          roleLabel={ROLE_LABEL[current.role].toLowerCase() === 'project manager' ? 'the project manager' : `the ${ROLE_LABEL[current.role].toLowerCase()}`}
        />

        <footer className="home-foot">
          <span className="home-foot__who">{profile?.full_name ?? email}</span>
          <SignOutButton />
        </footer>
      </section>
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
