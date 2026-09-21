import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject, guardScreen } from '@/lib/auth';
import { BrandMark } from '@/components/brand-mark';
import { OutboxStatus } from '@/components/outbox-status';
import { readSteps, type SwmsKind } from '@/lib/swms/model';
import { normaliseName } from '@/lib/crew/tickets';
import { SignScreen, type SignableSwms } from './sign-screen';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Sign on to a SWMS · Kooboolong IMS' };

/**
 * Every SWMS in use on this job, and whether you have signed on to it — the
 * worker's own door (README R89). A labourer reaches this and nothing else
 * of the SWMS screens; the reads are the database's rule: an active SWMS is
 * every member's, and your own sign-on is yours.
 */
export default async function SwmsSignPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { userId, profile, memberships } = await requireUser();
  const { project } = await searchParams;
  const current = resolveProject(memberships, project);
  if (!current) redirect('/');
  guardScreen(current, 'swms_sign');

  const myName = (profile?.full_name ?? '').replace(/\s+/g, ' ').trim();
  const supabase = await createClient();
  const { data: rows } = await supabase
    .from('swms')
    .select('id, kind, title, activity, version, activated_at, file_path, file_name, hrcw, ppe, steps, prepared_by')
    .eq('project_id', current.project_id)
    .eq('status', 'active')
    .order('title');
  const ids = (rows ?? []).map((r) => r.id as string);
  const { data: signons } = ids.length
    ? await supabase.from('swms_signons').select('swms_id, attendee_name, signed_on_device_at').in('swms_id', ids)
    : { data: [] };
  const mine = new Map<string, string>();
  for (const s of signons ?? []) {
    if (normaliseName(String(s.attendee_name)) === normaliseName(myName)) mine.set(String(s.swms_id), String(s.signed_on_device_at));
  }

  const list: SignableSwms[] = (rows ?? []).map((r) => ({
    id: r.id as string,
    kind: r.kind as SwmsKind,
    title: String(r.title),
    activity: (r.activity as string | null) ?? null,
    version: Number(r.version),
    activated_at: (r.activated_at as string | null) ?? null,
    file_path: (r.file_path as string | null) ?? null,
    file_name: (r.file_name as string | null) ?? null,
    hrcw: (r.hrcw as string[] | null) ?? [],
    ppe: (r.ppe as string[] | null) ?? [],
    steps: readSteps(r.steps),
    prepared_by: (r.prepared_by as string | null) ?? null,
    signedOnAt: mine.get(r.id as string) ?? null,
  }));

  return (
    <main className="sheet">
      <p className="label"><BrandMark size={18} /> {current.project.name}</p>
      <h1 className="page-title">Sign on to a SWMS</h1>
      <p className="page-subtitle">
        The method statements in use on this job. Read the one for your work, then sign on as yourself — once per version.
      </p>
      <OutboxStatus />
      <SignScreen projectId={current.project_id} userId={userId} myName={myName} list={list} />
    </main>
  );
}
