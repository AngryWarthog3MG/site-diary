import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject, canAuthorEntries } from '@/lib/auth';
import { BrandMark } from '@/components/brand-mark';
import { fmtDate } from '@/lib/pdf/dates';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Prestarts · KBS Daily Diary' };

/** Every prestart on the job, newest first; the unfinished ones flagged. */
export default async function PrestartListPage({
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
  const { data: rows } = await supabase
    .from('prestarts')
    .select('id, prestart_date, supervisor_name, completed_at, prestart_attendees(id, fit_for_work)')
    .eq('project_id', current.project_id)
    .order('prestart_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(60);

  const canRun = canAuthorEntries(current.role);

  return (
    <main className="sheet">
      <p className="label">
        <BrandMark size={18} /> {current.project.name}
      </p>
      <h1 className="page-title">Prestarts</h1>
      <p className="page-subtitle">
        Every morning before work starts: what is on, what could hurt someone, and who is
        here and fit to work. The crew sign on the phone, and finishing it makes a one-page
        PDF with everyone&rsquo;s signature.
      </p>
      {canRun && (
        <Link className="button" href={`/prestart/new?project=${current.project_id}`}>
          Start a prestart
        </Link>
      )}
      <hr className="rule" />

      {(rows ?? []).length === 0 && (
        <p className="claims-nil">
          No prestarts yet. The first one takes a couple of minutes — what is on today, the
          hazards, tick the checks, then hand the phone around.
        </p>
      )}

      <div className="talklist">
        {(rows ?? []).map((row) => {
          const attendees = (row.prestart_attendees ?? []) as Array<{ fit_for_work: boolean }>;
          const notFit = attendees.filter((a) => !a.fit_for_work).length;
          return (
            <Link key={row.id} className="talkcard" href={`/prestart/${row.id}`}>
              <div>
                <p className="mono talkcard__date">{fmtDate(row.prestart_date)}</p>
                <p className="talkcard__topic">Run by {row.supervisor_name}</p>
                <p className="talkcard__meta">
                  {attendees.length === 0 ? 'nobody signed on yet' : `${attendees.length} signed on`}
                  {notFit > 0 ? ` · ${notFit} not fit for work` : ''}
                </p>
              </div>
              <span className={`status-pill ${row.completed_at ? 'status-pill--signed' : 'status-pill--resume'}`}>
                {row.completed_at ? 'Done' : 'Not finished'}
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
