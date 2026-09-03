import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject, canAuthorEntries } from '@/lib/auth';
import { BrandMark } from '@/components/brand-mark';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Toolbox talks · KBS Daily Diary' };

/** The weekly safety talk register: newest first, open talks flagged. */
export default async function ToolboxPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const { memberships } = await requireUser();
  const { project } = await searchParams;
  const current = resolveProject(memberships, project);
  if (!current) {
    return (
      <main className="sheet">
        <p className="notice gap">You are not on an active project.</p>
      </main>
    );
  }

  const supabase = await createClient();
  const { data: talks } = await supabase
    .from('toolbox_talks')
    .select('id, talk_date, topic, presenter_name, completed_at, toolbox_attendees(id)')
    .eq('project_id', current.project_id)
    .order('talk_date', { ascending: false })
    .limit(50);

  const canRun = canAuthorEntries(current.role);

  return (
    <main className="sheet">
      <p className="label">
        <BrandMark size={18} /> {current.project.name}
      </p>
      <h1 className="page-title">Toolbox talks</h1>
      <p className="page-subtitle">
        One a week, a different topic each time. The crew sign on, and a completed talk is
        frozen — topic, summary and signatures export as one PDF.
      </p>
      {canRun && (
        <Link className="button" href={`/toolbox/new?project=${current.project_id}`}>
          New toolbox talk
        </Link>
      )}
      <hr className="rule" />

      {(talks ?? []).length === 0 && (
        <p className="claims-nil">No talks yet. The first one takes two minutes to set up.</p>
      )}

      <div className="talklist">
        {(talks ?? []).map((talk) => {
          const attendees = ((talk.toolbox_attendees ?? []) as unknown[]).length;
          return (
            <Link key={talk.id} className="talkcard" href={`/toolbox/${talk.id}`}>
              <div>
                <p className="mono talkcard__date">{talk.talk_date}</p>
                <p className="talkcard__topic">{talk.topic}</p>
                <p className="talkcard__meta">
                  {talk.presenter_name} · {attendees} signed on
                </p>
              </div>
              <span className={`status-pill ${talk.completed_at ? 'status-pill--signed' : 'status-pill--resume'}`}>
                {talk.completed_at ? 'Completed' : 'Open'}
              </span>
            </Link>
          );
        })}
      </div>

      <hr className="rule" />
      <Link className="button button--quiet" href={`/?project=${current.project_id}`}>
        Back to today
      </Link>
    </main>
  );
}
