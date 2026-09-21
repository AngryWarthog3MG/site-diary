import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject, guardScreen } from '@/lib/auth';
import { BrandMark } from '@/components/brand-mark';
import { NoticesScreen, type InboxEvent, type NoticeRow } from './notices-screen';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Notices · Kooboolong IMS' };

/**
 * The office's inbox of what the diary recorded as instructed or outside
 * scope, and the notices drafted from it (README R90). Only events on SIGNED
 * days are here — the signed diary is the record, and a notice stands on it.
 * A person writes and sends the notice; the app keeps the clock.
 */
export default async function NoticesPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { userId, memberships } = await requireUser();
  const { project } = await searchParams;
  const current = resolveProject(memberships, project);
  if (!current) redirect('/');
  guardScreen(current, 'notices');

  const supabase = await createClient();
  const [{ data: events }, { data: notices }, { data: triage }] = await Promise.all([
    supabase
      .from('site_events')
      .select('id, said_text, location, directed_by, occurred_time, photo_urls, entry:entries!inner(id, entry_no, entry_date, status, project_id, signed_at)')
      .eq('entry.project_id', current.project_id)
      .eq('entry.status', 'signed'),
    supabase
      .from('notices')
      .select('id, seq, site_event_id, what_happened, why_outside_scope, work_affected, what_we_need, evidence, sent_at, sent_how, sent_to, reference, voided_at, void_reason, created_at')
      .eq('project_id', current.project_id)
      .order('created_at', { ascending: false }),
    supabase.from('site_event_triage').select('site_event_id, reason, decided_at').eq('project_id', current.project_id),
  ]);

  type Ent = { id: string; entry_no: string | null; entry_date: string; signed_at: string | null };
  const rows: InboxEvent[] = ((events ?? []) as Array<Record<string, unknown>>)
    .map((e) => {
      const ent = (Array.isArray(e.entry) ? e.entry[0] : e.entry) as Ent;
      return {
        id: String(e.id),
        said_text: String(e.said_text),
        location: (e.location as string | null) ?? null,
        directed_by: (e.directed_by as string | null) ?? null,
        occurred_time: (e.occurred_time as string | null) ?? null,
        photos: ((e.photo_urls as string[] | null) ?? []).length,
        entry_id: ent.id,
        entry_no: ent.entry_no,
        entry_date: ent.entry_date,
        signed_at: ent.signed_at,
      };
    })
    .sort((a, b) => b.entry_date.localeCompare(a.entry_date));

  const noticeRows = ((notices ?? []) as NoticeRow[]).map((n) => ({ ...n }));
  const dismissed = new Map(((triage ?? []) as Array<{ site_event_id: string; reason: string; decided_at: string }>).map((t) => [t.site_event_id, t]));

  return (
    <main className="sheet sheet--wide">
      <p className="label"><BrandMark size={18} /> {current.project.name}</p>
      <h1 className="page-title">Notices</h1>
      <p className="page-subtitle">
        What the diary recorded as instructed, or outside our scope, on signed days — and the notices drafted from it. A
        notice is written and sent by you; this screen keeps the clock, because the contract wants prompt notice.
      </p>
      <NoticesScreen
        projectId={current.project_id}
        userId={userId}
        events={rows}
        notices={noticeRows}
        dismissed={Object.fromEntries(dismissed)}
        now={new Date().toISOString()}
      />
    </main>
  );
}
