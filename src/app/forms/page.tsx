import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject, guardScreen } from '@/lib/auth';
import { canRunTalks } from '@/lib/roles';
import { BrandMark } from '@/components/brand-mark';
import { OutboxStatus } from '@/components/outbox-status';
import { Fold } from '@/components/fold';
import { fmtPerthDate } from '@/lib/pdf/dates';
import { perthToday } from '@/lib/push/decide';
import { loadTemplates, loadSubmissions, loadNonCompliances, namesFor } from '@/lib/forms/load';
import { summariseForms, CATEGORY_LABEL } from '@/lib/forms/model';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Forms · Kooboolong IMS' };

/**
 * Forms (README R180): the ones this person may fill, the ones they have open, and the job's completed-forms
 * register. The database decides which forms name them; this page draws what comes back.
 */
export default async function FormsPage({ searchParams }: { searchParams: Promise<{ project?: string; month?: string }> }) {
  const { memberships, userId } = await requireUser();
  const { project, month } = await searchParams;
  const current = resolveProject(memberships, project);
  if (!current) return <main className="sheet"><p className="notice gap">You are not on an active project.</p></main>;
  guardScreen(current, 'forms');
  const supabase = await createClient();
  const today = perthToday();
  const q = `?project=${current.project_id}`;
  const [templates, subs, ncs] = await Promise.all([
    loadTemplates(supabase, current.project.org.id),
    loadSubmissions(supabase, current.project_id, { month: month ?? null }),
    loadNonCompliances(supabase, { projectId: current.project_id }),
  ]);
  const fillable = templates.filter((t) => t.status === 'issued');
  const nameOf = await namesFor(supabase, subs.map((s) => s.completed_by ?? s.started_by));
  const mine = subs.filter((s) => s.status === 'open' && s.started_by === userId);
  const completed = subs.filter((s) => s.status !== 'open');
  const sum = summariseForms(subs, ncs, today);
  const isOffice = current.role === 'pm' || current.role === 'admin';
  const labourer = current.role === 'labourer';

  return (
    <main className="sheet">
      <p className="label"><BrandMark size={18} /> {current.project.name}</p>
      <h1 className="page-title">Forms</h1>
      <p className="page-subtitle">
        The company&rsquo;s checklists, filled on the phone and saved as you go. A failing answer goes on the non-compliance register;
        the ones the form says to raise become actions. Nothing is on the record until the form is completed.
      </p>
      <OutboxStatus />

      <section className="item">
        <p className="label">Fill a form</p>
        {fillable.length === 0 ? <p className="nil">No forms issued for you yet{isOffice ? <> — <Link href={`/forms/design${q}`}>design one</Link></> : ''}.</p> : (
          <div className="inspection-pick">
            {fillable.map((t) => (
              <Link key={t.id} href={`/forms/fill/new${q}&template=${t.id}`} className="prestart-row inspection-pick__row">
                <span><strong>{t.title}</strong><br /><span className="caption">{t.code} rev {t.revision} · {CATEGORY_LABEL[t.category]}{t.basis ? ` · ${t.basis}` : ''}</span></span>
                <span>Start</span>
              </Link>
            ))}
          </div>
        )}
        {isOffice && <p className="caption"><Link href={`/forms/design${q}`}>Form designer</Link></p>}
      </section>

      {mine.length > 0 && (
        <section className="item">
          <p className="label">Your open forms · {mine.length}</p>
          {mine.map((s) => (
            <Link key={s.id} href={`/forms/fill/${s.id}${q}`} className="prestart-row prestart-row--open">
              <span><strong>{s.template_title}</strong><br /><span className="caption">started {fmtPerthDate(s.started_at)}{s.subject_person ? ` · ${s.subject_person}` : ''}</span></span>
              <span>Continue</span>
            </Link>
          ))}
        </section>
      )}

      {!labourer && (
        <>
          <section className="entries-summary" aria-label="Summary" style={{ marginTop: '1rem' }}>
            <div><p className="label">Completed</p><p className="entries-summary__value mono">{sum.completed}</p></div>
            <div><p className="label">Failed</p><p className={`entries-summary__value mono${sum.failed > 0 ? ' vr-missing' : ''}`}>{sum.failed}</p></div>
            <div><p className="label">Non-compliances open</p><p className={`entries-summary__value mono${sum.ncOpen > 0 ? ' vr-missing' : ''}`}>{sum.ncOpen}</p></div>
          </section>
          <p className="caption"><Link href={`/forms/non-compliance${q}`}>Non-compliance register</Link></p>
          <hr className="rule" />
        </>
      )}

      <section className="item">
        <p className="label">{labourer ? 'Your completed forms' : 'Completed forms'}{month ? ` · ${month}` : ''}</p>
        {!labourer && (
          <form method="get" className="signin__grid" style={{ marginBottom: '0.5rem' }}>
            <input type="hidden" name="project" value={current.project_id} />
            <label className="fieldcell fieldcell--narrow"><span className="label">Month</span><input className="field field--sm" type="month" name="month" defaultValue={month ?? ''} /></label>
            <button type="submit" className="button button--quiet" style={{ marginTop: 0, alignSelf: 'end' }}>Show</button>
          </form>
        )}
        {completed.length === 0 ? <p className="nil">None{month ? ' that month' : ' yet'}.</p> : (
          <Fold label="Completed forms" count={completed.length} phoneOnly>
            {completed.map((s) => (
              <Link key={s.id} href={`/forms/${s.id}${q}`} className={`prestart-row${s.status === 'voided' ? ' prestart-row--done' : s.outcome === 'fail' ? ' prestart-row--open' : ' prestart-row--done'}`}>
                <span>
                  <strong>{s.template_title}</strong> · {s.template_code}
                  <br />
                  <span className="caption">{fmtPerthDate(s.completed_at)} · {nameOf.get(s.completed_by ?? s.started_by) ?? 'someone'}{s.subject_person ? ` · ${s.subject_person}` : ''}</span>
                  <br />
                  <span className="caption">{s.status === 'voided' ? 'VOIDED' : s.outcome === 'fail' ? 'Fail' : 'Pass'}{s.score != null ? ` · ${s.score}%` : ''}</span>
                </span>
                <span>Open</span>
              </Link>
            ))}
          </Fold>
        )}
      </section>
      {canRunTalks(current.role) ? null : null}
    </main>
  );
}
