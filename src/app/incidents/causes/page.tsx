import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject, guardScreen } from '@/lib/auth';
import { canAuthorEntries } from '@/lib/roles';
import { BrandMark } from '@/components/brand-mark';
import { CausesEditor } from './causes-editor';
import type { CauseKind } from '@/lib/incidents/investigation';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Causes and factors · Kooboolong IMS' };

/** The company's own root causes and contributing factors (README R178), beside the built-in ones. */
export default async function CausesPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { memberships, userId } = await requireUser();
  const { project } = await searchParams;
  const current = resolveProject(memberships, project);
  if (!current) return <main className="sheet"><p className="notice gap">You are not on an active project.</p></main>;
  guardScreen(current, 'incidents');
  if (!canAuthorEntries(current.role)) redirect(`/incidents?project=${current.project_id}`);
  const supabase = await createClient();
  const { data } = await supabase.from('org_incident_causes').select('id, kind, key, label, active').eq('org_id', current.project.org.id).order('label');
  return (
    <main className="sheet">
      <p className="label"><BrandMark size={18} /> {current.project.org.name}</p>
      <h1 className="page-title">Causes and factors</h1>
      <p className="page-subtitle">
        The lists an investigation picks from. The built-in ones are always there; add the company&rsquo;s own here. A record
        keeps the words as they read when chosen, so retiring one changes nothing already written. <Link href={`/incidents?project=${current.project_id}`}>Back to the register</Link>
      </p>
      <CausesEditor orgId={current.project.org.id} userId={userId} rows={(data ?? []) as Array<{ id: string; kind: CauseKind; key: string; label: string; active: boolean }>} />
    </main>
  );
}
