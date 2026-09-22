import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject, guardScreen } from '@/lib/auth';
import { BrandMark } from '@/components/brand-mark';
import { HomeFoot } from '@/components/home-foot';
import { perthToday } from '@/lib/push/decide';
import type { Programme } from '@/lib/programme/model';
import { ProgrammeScreen } from './programme-screen';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Programme · Kooboolong IMS' };

/**
 * The programme (README R95): the construction programme as the head
 * contractor issued it, revision by revision, and the two-week look-aheads.
 * Read by every member of the job; kept by the supervisor and the office.
 */
export default async function ProgrammePage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { memberships } = await requireUser();
  const { project } = await searchParams;
  const current = resolveProject(memberships, project);
  if (!current) redirect('/');
  guardScreen(current, 'programme');

  const supabase = await createClient();
  const { data } = await supabase.from('project_programmes').select('*').eq('project_id', current.project_id);
  const rows = ((data ?? []) as Programme[]).map((r) => ({ ...r, size_bytes: r.size_bytes == null ? null : Number(r.size_bytes) }));
  const canKeep = current.role === 'supervisor' || current.role === 'pm' || current.role === 'admin';

  return (
    <main className="sheet">
      <Suspense fallback={null}>
        <HomeFoot at="top" />
      </Suspense>
      <p className="label"><BrandMark size={18} /> {current.project.name} · {current.project.code}</p>
      <h1 className="page-title">Programme</h1>
      <p className="page-subtitle">
        The construction programme as issued — every revision kept, the newest in force — and the two-week look-aheads
        the crew works to. Files open as they were uploaded; nothing here is rewritten.
      </p>
      <ProgrammeScreen projectId={current.project_id} rows={rows} canKeep={canKeep} today={perthToday()} />
    </main>
  );
}
