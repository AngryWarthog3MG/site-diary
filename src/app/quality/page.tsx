import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser, resolveProject } from '@/lib/auth';
import { sees, canAuthorEntries, canRunTalks } from '@/lib/roles';
import { BrandMark } from '@/components/brand-mark';
import { fmtDate } from '@/lib/pdf/dates';
import { perthDayOf } from '@/lib/emergency/model';
import {
  itpRef, lotRef, ncrRef, LOT_STATUS_LABEL, NCR_STATUS_LABEL, ncrReportState,
  type LotStatus, type NcrStatus,
} from '@/lib/quality/model';
import { NewItpForm, OpenLotForm, RaiseNcrForm, NcrClockSetting } from './quality-forms';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Quality · KBS Daily Diary' };

/**
 * The job's quality record: its inspection and test plans, the lots worked to
 * them, the non-conformances raised, and the calibration register behind the
 * measurements. What Main Roads WA Specification 201 and council
 * specifications ask a civil contractor to run, and ISO 9001 cl. 8.5–8.7 and
 * 7.1.5 to evidence.
 */
export default async function QualityPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { memberships } = await requireUser();
  const { project } = await searchParams;
  const current = resolveProject(memberships, project);
  if (!current) return <main className="sheet"><p className="notice gap">You are not on an active project.</p></main>;
  if (!sees(current, 'quality')) redirect(`/?project=${current.project_id}`);

  const supabase = await createClient();
  const q = `?project=${current.project_id}`;
  const [{ data: itpRows }, { data: lotRows }, { data: ncrRows }, { data: proj }] = await Promise.all([
    supabase.from('itps').select('id, code, title, revision, status, spec_reference, issued_at, itp_points(id)').eq('project_id', current.project_id).order('code').order('revision', { ascending: false }),
    supabase.from('lots').select('id, seq, description, location, status, itp_id, opened_at').eq('project_id', current.project_id).order('seq', { ascending: false }),
    supabase.from('ncrs').select('id, seq, observation, status, detected_at, reported_to_principal_at, lot_id').eq('project_id', current.project_id).order('seq', { ascending: false }),
    supabase.from('projects').select('ncr_report_hours').eq('id', current.project_id).single(),
  ]);
  const itps = (itpRows ?? []) as Array<{ id: string; code: string; title: string; revision: number; status: 'draft' | 'issued' | 'superseded'; spec_reference: string | null; issued_at: string | null; itp_points: Array<{ id: string }> }>;
  const lots = (lotRows ?? []) as Array<{ id: string; seq: number; description: string; location: string; status: LotStatus; itp_id: string; opened_at: string }>;
  const ncrs = (ncrRows ?? []) as Array<{ id: string; seq: number; observation: string; status: NcrStatus; detected_at: string; reported_to_principal_at: string | null; lot_id: string | null }>;
  const clock = (proj?.ncr_report_hours as number | null) ?? null;
  const now = new Date().toISOString();
  const issued = itps.filter((i) => i.status === 'issued');
  const lotById = new Map(lots.map((l) => [l.id, l]));
  const canManage = canAuthorEntries(current.role);
  const canRun = canRunTalks(current.role);

  return (
    <main className="sheet">
      <p className="label"><BrandMark size={18} /> {current.project.name}</p>
      <h1 className="page-title">Quality</h1>
      <p className="page-subtitle">
        Inspection and test plans, the lots worked to them, hold points, non-conformances, and the calibration register.
      </p>

      <div className="chemreg__stats">
        <span><strong className="mono">{lots.filter((l) => l.status === 'open').length}</strong> lots open</span>
        <span className={lots.some((l) => l.status === 'nonconforming') ? 'vr-missing' : undefined}><strong className="mono">{lots.filter((l) => l.status === 'nonconforming').length}</strong> on hold</span>
        <span className={ncrs.some((n) => n.status !== 'closed') ? 'vr-missing' : undefined}><strong className="mono">{ncrs.filter((n) => n.status !== 'closed').length}</strong> NCRs not closed</span>
      </div>
      <p style={{ marginTop: '0.6rem' }}><Link href={`/quality/equipment${q}`}>Calibration register</Link></p>

      <section style={{ marginTop: '1rem' }}>
        <hr className="rule" />
        <p className="label">Non-conformances</p>
        {ncrs.length === 0 ? <p className="nil">None raised.</p> : (
          <div className="chemreg__list">
            {ncrs.map((n) => {
              const clockState = ncrReportState(n.detected_at, n.reported_to_principal_at, clock, now);
              return (
                <Link key={n.id} href={`/quality/ncr/${n.id}${q}`} className={`prestart-row ${n.status === 'closed' ? 'prestart-row--done' : 'prestart-row--open'}`}>
                  <span>
                    <strong>{ncrRef(n.seq)}</strong>{n.lot_id && lotById.get(n.lot_id) ? ` · ${lotRef(lotById.get(n.lot_id)!.seq)}` : ''} · {n.observation.length > 70 ? `${n.observation.slice(0, 70)}…` : n.observation}
                    <br />
                    <span className={`caption${clockState.state === 'overdue' ? ' vr-missing' : ''}`}>
                      {NCR_STATUS_LABEL[n.status]} · detected {fmtDate(perthDayOf(n.detected_at))}
                      {clockState.state === 'overdue' ? ' · not reported to the principal in time' : clockState.state === 'due' ? ' · to report to the principal' : ''}
                    </span>
                  </span>
                  <span className="chemreg__open">Open</span>
                </Link>
              );
            })}
          </div>
        )}
        {canRun && <RaiseNcrForm projectId={current.project_id} />}
      </section>

      <section style={{ marginTop: '1.25rem' }}>
        <hr className="rule" />
        <p className="label">Lots</p>
        {lots.length === 0 ? <p className="nil">No lots opened.</p> : (
          <div className="chemreg__list">
            {lots.map((l) => (
              <Link key={l.id} href={`/quality/lot/${l.id}${q}`} className={`prestart-row ${l.status === 'nonconforming' ? 'prestart-row--open' : l.status === 'open' ? '' : 'prestart-row--done'}`}>
                <span>
                  <strong>{lotRef(l.seq)}</strong> · {l.description}
                  <br /><span className={`caption${l.status === 'nonconforming' ? ' vr-missing' : ''}`}>{LOT_STATUS_LABEL[l.status]} · {l.location}</span>
                </span>
                <span className="chemreg__open">Open</span>
              </Link>
            ))}
          </div>
        )}
        {canRun && (issued.length > 0
          ? <OpenLotForm projectId={current.project_id} itps={issued.map((i) => ({ id: i.id, label: `${itpRef(i.code, i.revision)} — ${i.title}` }))} />
          : <p className="caption">Issue an inspection and test plan before opening a lot against it.</p>)}
      </section>

      <section style={{ marginTop: '1.25rem' }}>
        <hr className="rule" />
        <p className="label">Inspection and test plans</p>
        {itps.length === 0 ? <p className="nil">No ITPs yet.</p> : (
          <div className="chemreg__list">
            {itps.map((i) => (
              <Link key={i.id} href={`/quality/itp/${i.id}${q}`} className={`prestart-row ${i.status === 'issued' ? '' : 'prestart-row--done'}`}>
                <span>
                  <strong>{itpRef(i.code, i.revision)}</strong> · {i.title}
                  <br />
                  <span className="caption">
                    {i.status === 'draft' ? 'Draft' : i.status === 'issued' ? `Issued ${i.issued_at ? fmtDate(perthDayOf(i.issued_at)) : ''}` : 'Superseded'}
                    {' · '}{i.itp_points.length} point{i.itp_points.length === 1 ? '' : 's'}{i.spec_reference ? ` · ${i.spec_reference}` : ''}
                  </span>
                </span>
                <span className="chemreg__open">Open</span>
              </Link>
            ))}
          </div>
        )}
        {canManage && <NewItpForm projectId={current.project_id} />}
      </section>

      <section style={{ marginTop: '1.25rem' }}>
        <hr className="rule" />
        <p className="label">Reporting a non-conformance to the principal</p>
        <p className="caption">
          {clock == null
            ? 'No reporting deadline set for this job. Set one if the contract has it — Main Roads WA Specification 201 asks for 24 hours.'
            : `This job's contract: report a non-conformance to the principal within ${clock} hours of detecting it.`}
        </p>
        {current.role === 'admin' && <NcrClockSetting projectId={current.project_id} hours={clock} />}
      </section>
    </main>
  );
}
