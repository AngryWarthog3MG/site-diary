import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject } from '@/lib/auth';
import { loadClaimsData, type ClaimsData } from '@/lib/claims/load';
import { BrandMark } from '@/components/brand-mark';
import { RegisterSection } from '@/app/claims/register-section';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Variations · KBS Daily Diary' };

/**
 * The variation register on its own: every variation the diary has signed,
 * tracked from raised to paid. The same section sits on the Claims screen;
 * this is the door for the person whose job is chasing them.
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
      <h1 className="page-title">Variations</h1>
      <p className="page-subtitle">
        Every variation you have signed off, tracked from raised to paid. A variation joins
        this list the day you sign the diary that records it; from there you move it along as
        it is priced, sent, decided and paid, and each move is kept with who made it and when.
      </p>
      <hr className="rule" />
      {loadError && <p className="notice gap">{loadError}</p>}
      {data && <RegisterSection data={data} userId={userId} />}
    </main>
  );
}
