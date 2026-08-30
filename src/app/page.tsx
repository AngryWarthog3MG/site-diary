import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import {
  requireUser,
  resolveProject,
  canAuthorEntries,
} from '@/lib/auth';
import { SignOutButton } from '@/components/sign-out-button';
import { NextEntryLine } from './next-entry-line';
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
      <main className="sheet">
        <p className="label">Site Diary</p>
        <hr className="rule" />
        <p className="notice gap">
          You are signed in as <strong>{email}</strong>, and that account is not on a
          project yet. If that is the wrong address, sign out and use the right one; if it
          is right, your site admin needs to add you.
        </p>
        <hr className="rule" />
        <SignOutButton />
      </main>
    );
  }

  const supabase = await createClient();
  const { data: lastSigned } = await supabase
    .from('entries')
    .select('entry_no, entry_date, signed_at')
    .eq('project_id', current.project_id)
    .eq('status', 'signed')
    .order('entry_seq', { ascending: false })
    .limit(1)
    .maybeSingle();

  return (
    <main className="sheet">
      <p className="label">{current.project.org.name}</p>
      <h1 style={{ margin: '0.125rem 0 0', fontSize: '1.375rem', fontWeight: 600 }}>
        {current.project.name}
      </h1>
      <NextEntryLine orgCode={current.project.org.code} />

      <ProjectSwitcher memberships={memberships} currentId={current.project_id} />

      <hr className="rule" />

      <TodayPanel
        projectId={current.project_id}
        canRecord={canAuthorEntries(current.role)}
        lastSigned={lastSigned ?? null}
      />

      <hr className="rule" />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div>
          <p className="label">Signed in as</p>
          <p className="mono" style={{ margin: '0.25rem 0 0', fontSize: '0.875rem', color: 'var(--ink-60)' }}>
            {profile?.full_name ?? email}
          </p>
        </div>
      </div>
      <SignOutButton />
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
    <ul className="chips" style={{ marginTop: '0.875rem' }}>
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
