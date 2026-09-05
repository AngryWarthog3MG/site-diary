import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject, canAuthorEntries } from '@/lib/auth';
import { BrandMark } from '@/components/brand-mark';
import { fmtDate } from '@/lib/pdf/dates';

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
        One a week, a different topic each time. Read the talk out, get the crew to sign on
        the phone, and finish it — that turns it into a one-page PDF you can send anyone who
        asks for your safety records.
      </p>
      {canRun && (
        <Link className="button" href={`/toolbox/new?project=${current.project_id}`}>
          New toolbox talk
        </Link>
      )}
      <hr className="rule" />

      {(talks ?? []).length === 0 && (
        <p className="claims-nil">
          No talks yet. Setting the first one up takes about two minutes — a topic, a few
          lines on what you will cover, and who is giving it.
        </p>
      )}

      <div className="talklist">
        {(talks ?? []).map((talk) => {
          const attendees = ((talk.toolbox_attendees ?? []) as unknown[]).length;
          return (
            <Link key={talk.id} className="talkcard" href={`/toolbox/${talk.id}`}>
              <div>
                <p className="mono talkcard__date">{fmtDate(talk.talk_date)}</p>
                <p className="talkcard__topic">{talk.topic}</p>
                <p className="talkcard__meta">
                  {talk.presenter_name} ·{' '}
                  {attendees === 0 ? 'nobody signed on yet' : `${attendees} signed on`}
                </p>
              </div>
              <span className={`status-pill ${talk.completed_at ? 'status-pill--signed' : 'status-pill--resume'}`}>
                {talk.completed_at ? 'Done' : 'To run'}
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
