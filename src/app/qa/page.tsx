import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject, guardScreen } from '@/lib/auth';
import { sees } from '@/lib/roles';
import { BrandMark } from '@/components/brand-mark';
import { fmtPerthDate } from '@/lib/pdf/dates';
import { loadQaHome } from '@/lib/qa/load';
import { STATE_LABEL } from '@/lib/qa/model';
import { KIND_LABEL } from '@/lib/qa/model';
import { BringOnItp } from './qa-forms';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'ITPs & ITRs · Kooboolong IMS' };

const ITP_STATUS: Record<string, string> = { draft: 'Draft', issued: 'Issued to the head contractor', approved: 'Approved', signed: 'Signed off' };

/**
 * The job's QA home (README R164): each inspection and test plan brought onto the job, and under it the records —
 * one per lot, pour or element — filled in against the ITRs it governs. A new record starts from here with an id the
 * phone chooses, so it can be filled with no signal and sent later exactly once.
 */
export default async function QaHomePage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { memberships } = await requireUser();
  const { project } = await searchParams;
  const current = resolveProject(memberships, project);
  if (!current) return <main className="sheet"><p className="notice gap">You are not on an active project.</p></main>;
  if (!sees(current, 'qa')) redirect(`/?project=${current.project_id}`);
  guardScreen(current, 'qa');
  const supabase = await createClient();
  const orgId = current.project.org.id;
  const q = `?project=${current.project_id}`;
  const office = current.role === 'admin' || current.role === 'pm';
  const canWrite = current.role !== 'labourer';

  let home: Awaited<ReturnType<typeof loadQaHome>> | null = null;
  let loadError: string | null = null;
  try { home = await loadQaHome(supabase, orgId, current.project_id); } catch (e) { loadError = e instanceof Error ? e.message : 'Could not load the QA records.'; }

  return (
    <main className="sheet sheet--wide">
      <p className="label"><BrandMark size={18} /> {current.project.name}</p>
      <h1 className="page-title">ITPs &amp; ITRs</h1>
      <p className="page-subtitle">
        The inspection and test plans for this job, and the records filled in against them — one for every lot, pour or
        element. A record is saved as you go, with or without signal, and is frozen once every party has signed.
      </p>
      {loadError && <p className="alert">{loadError}</p>}

      {home && home.itps.length === 0 && (
        <p className="claims-nil">No inspection and test plan on this job yet.{office && home.available.length ? ' Bring one on below.' : ''}</p>
      )}

      {home?.itps.map((b) => (
        <section key={b.instance.id} className="qa-itp">
          <div className="qa-itp__head">
            <div>
              <p className="label">{b.template.code} · Rev {b.template.revision}</p>
              <h2 className="home-card__title"><Link className="claims-cite" href={`/qa/itp/${b.instance.id}${q}`}>{b.template.title}</Link></h2>
              <p className="caption">
                {ITP_STATUS[b.instance.status] ?? b.instance.status}
                {b.instance.issued_to ? ` · ${b.instance.issued_to}` : ''}
                {b.instance.approved_at ? ` · approved by ${b.instance.approved_by_name} ${fmtPerthDate(b.instance.approved_at)}` : ''}
                {' · '}{(b.template.spec.activities ?? []).length} activities
              </p>
            </div>
            <Link className="button button--quiet qa-itp__open" href={`/qa/itp/${b.instance.id}${q}`}>Open the ITP</Link>
          </div>

          {b.forms.length === 0 && <p className="caption">No inspection and test record form names this ITP yet.</p>}
          {b.forms.map((f) => (
            <div key={f.template.id} className="qa-form">
              <div className="qa-form__head">
                <div>
                  <p className="label">{f.template.code} · Rev {f.template.revision} · {KIND_LABEL[f.template.kind]}</p>
                  <h3 className="qa-form__title">{f.template.title}</h3>
                </div>
                {canWrite && b.instance.status !== 'draft' && (
                  <Link className="button qa-form__new" href={`/qa/record/new${q}&template=${f.template.id}&itp=${b.instance.id}`}>New {f.template.kind === 'itr_register' ? 'register' : 'record'}</Link>
                )}
                {canWrite && b.instance.status === 'draft' && <span className="caption">Issue the ITP before recording against it.</span>}
              </div>
              {f.records.length === 0 ? (
                <p className="caption">Nothing recorded yet.</p>
              ) : (
                <ul className="qa-records">
                  {f.records.map(({ row, state }) => (
                    <li key={row.id} className={`qa-record qa-record--${state}`}>
                      <Link className="qa-record__main" href={`/qa/record/${row.id}${q}`}>
                        <span className="qa-record__lot">{row.lot_or_element ?? 'No lot named'}</span>
                        <span className="caption">
                          {row.header && typeof row.header === 'object' && 'pour_date' in row.header && row.header.pour_date ? `Pour ${String(row.header.pour_date)} · ` : ''}
                          {row.signoffs.length} of {(f.template.spec.signoffs ?? []).filter((s) => s.required).length} signed
                          {row.gap_count ? ` · ${row.gap_count} gap${row.gap_count === 1 ? '' : 's'}` : ''}
                          {' · '}updated {fmtPerthDate(row.updated_at)}
                        </span>
                      </Link>
                      <span className={`pe-badge pe-badge--${state === 'released' || state === 'complete' ? 'ok' : state === 'voided' ? 'mute' : state === 'gaps_open' ? 'bad' : 'warn'}`}>{STATE_LABEL[state]}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </section>
      ))}

      {home && home.other.length > 0 && (
        <section className="qa-itp">
          <p className="label">Other forms</p>
          {home.other.map((f) => (
            <div key={f.template.id} className="qa-form">
              <div className="qa-form__head">
                <div><p className="label">{f.template.code} · Rev {f.template.revision}</p><h3 className="qa-form__title">{f.template.title}</h3></div>
                {canWrite && <Link className="button qa-form__new" href={`/qa/record/new${q}&template=${f.template.id}`}>New</Link>}
              </div>
              {f.records.length > 0 && (
                <ul className="qa-records">
                  {f.records.map(({ row, state }) => (
                    <li key={row.id} className={`qa-record qa-record--${state}`}>
                      <Link className="qa-record__main" href={`/qa/record/${row.id}${q}`}><span className="qa-record__lot">{row.lot_or_element ?? 'No lot named'}</span><span className="caption">updated {fmtPerthDate(row.updated_at)}</span></Link>
                      <span className="pe-badge pe-badge--mute">{STATE_LABEL[state]}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </section>
      )}

      {office && home && home.available.length > 0 && (
        <BringOnItp projectId={current.project_id} headContractor={null} templates={home.available.map((t) => ({ id: t.id, code: t.code, revision: t.revision, title: t.title }))} />
      )}
      {!office && home && home.itps.length === 0 && <p className="caption">The office brings an inspection and test plan onto the job.</p>}

      <p className="caption" style={{ marginTop: '1rem' }}>Lots, hold points and non-conformances by the conformance rules: <Link href={`/quality${q}`}>Quality</Link>.</p>
    </main>
  );
}
