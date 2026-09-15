import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject } from '@/lib/auth';
import { sees, canManageRegisters } from '@/lib/roles';
import { loadClaimsData, type ClaimsData } from '@/lib/claims/load';
import { BrandMark } from '@/components/brand-mark';
import { perthToday } from '@/lib/push/decide';
import { VariationTracker } from './variation-tracker';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Variation tracker · KBS Daily Diary' };

/**
 * The variation register as a tracker: the pipeline up top, then one card per
 * variation saying where it is, what it is waiting on and the days behind it.
 * The Claims screen keeps the plainer section; this is the door for the
 * person whose job is chasing them.
 */
export default async function VariationsPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const { userId, memberships } = await requireUser();
  const { project } = await searchParams;
  const current = resolveProject(memberships, project);
  if (!current) {
    return (
      <main className="sheet">
        <p className="notice gap">You are not on an active project.</p>
      </main>
    );
  }
  if (!sees(current, 'variations')) redirect(`/?project=${current.project_id}`);

  let data: ClaimsData | null = null;
  let loadError: string | null = null;
  try {
    data = await loadClaimsData(await createClient(), {
      id: current.project_id,
      name: current.project.name,
      code: current.project.code,
      orgCode: current.project.org.code,
    });
  } catch (error) {
    loadError = error instanceof Error ? error.message : 'Could not load the register.';
  }

  return (
    <main className="sheet sheet--wide">
      <p className="label">
        <BrandMark size={18} /> {current.project.name}
      </p>
      <h1 className="page-title">Variation tracker</h1>
      <p className="page-subtitle">
        Every variation the diary has recorded, walked from raised to paid. Tap a stage to see what sits there;
        tap a variation for the days behind it, its history, and to move it along.
      </p>
      <hr className="rule" />
      {loadError && <p className="notice gap">{loadError}</p>}
      {data && <VariationTracker data={data} userId={userId} canManage={canManageRegisters(current.role)} today={perthToday()} />}
    </main>
  );
}
