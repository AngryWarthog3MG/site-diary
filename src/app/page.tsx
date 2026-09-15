import Link from 'next/link';
import { BrandMark } from '@/components/brand-mark';
import { RefreshButton } from '@/components/refresh-button';
import {
  requireUser,
  resolveProject,
  canAuthorEntries,
} from '@/lib/auth';
import { canRunTalks, ROLE_LABEL } from '@/lib/roles';
import { NAV_GROUPS, showNav, viewerFor } from '@/lib/nav';
import { SignOutButton } from '@/components/sign-out-button';
import { TodayPanel } from './today-panel';

export const dynamic = 'force-dynamic';

/**
 * The opening page. The job and the day at the top — today's diary, the
 * prestart, who is on site, the week, anything not signed — and under it
 * every section of the app as a tile, grouped the way the menu groups them,
 * so nothing on the job is more than one tap from here. The tiles are the
 * same list the drawer and the rail draw (`src/lib/nav.ts`), filtered by the
 * role the server already knows.
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

  return (
    <main className="app-shell home-shell">
      <section className="sheet home-sheet">
        <div className="home-top">
          <p className="label home-top__job">
            <BrandMark size={18} /> {current.project.name}
            <span className="mono home-top__code">{current.project.org.code}_{current.project.code}</span>
          </p>
          <RefreshButton />
        </div>
        <ProjectSwitcher memberships={memberships} currentId={current.project_id} />

        <div className="home-body">
          <TodayPanel
            projectId={current.project_id}
            canRecord={canAuthorEntries(current.role)}
            canPrestart={canRunTalks(current.role)}
            roleLabel={ROLE_LABEL[current.role].toLowerCase() === 'project manager' ? 'the project manager' : `the ${ROLE_LABEL[current.role].toLowerCase()}`}
          />
          <HomeSections role={current.role} activeJobs={activeJobs} q={q} />
        </div>

        <footer className="home-foot">
          <span className="home-foot__who">{profile?.full_name ?? email} · {ROLE_LABEL[current.role]}</span>
          <SignOutButton />
        </footer>
      </section>
    </main>
  );
}

/**
 * Every section of the app, as tiles, grouped as the menu groups them. Drawn
 * on the server from the role, so the page arrives complete — no tile appears
 * a moment late or closes on the person who tapped it.
 */
function HomeSections({ role, activeJobs, q }: { role: Parameters<typeof viewerFor>[0]; activeJobs: number; q: string }) {
  const viewer = viewerFor(role, activeJobs);
  return (
    <nav className="home-sections" aria-label="Everything on this job">
      {NAV_GROUPS.map((group) => {
        const items = group.items.filter((it) => showNav(it, viewer));
        if (items.length === 0) return null;
        return (
          <section key={group.label} className="home-group">
            <p className="label">{group.label}</p>
            <div className="home-tiles">
              {items.map((it) => (
                <Link key={it.href} className="navitem" href={it.href === '/portfolio' ? it.href : `${it.href}${q}`}>
                  <span className="navitem__name">{it.name}</span>
                  <span className="navitem__what">{it.what}</span>
                </Link>
              ))}
            </div>
          </section>
        );
      })}
    </nav>
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
