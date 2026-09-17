'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { fmtDate } from '@/lib/pdf/dates';
import {
  POINT_TYPE_LABEL, RESULTS, RESULT_LABEL, LOT_STATUS_LABEL, NCR_STATUS_LABEL, ncrRef,
  lotCloseProblems, latestChecks, testingAllowed, calibratedOn,
  type LotStatus, type PointType, type Result, type NcrStatus, type Disposition,
} from '@/lib/quality/model';
import { RaiseNcrForm } from '../../quality-forms';

interface Lot { id: string; projectId: string; itpId: string; seq: number; description: string; location: string; surveyedPosition: string | null; status: LotStatus; closeNote: string | null; hasReplacement: boolean }
interface Point { id: string; seq: number; activity: string; inspection_test: string; acceptance_criteria: string; method: string | null; frequency: string; responsible: string; point_type: PointType; uses_calibrated_equipment: boolean; record_required: string | null }
interface Check { id: string; itp_point_id: string; result: Result; measured: string | null; test_reference: string | null; equipment_id: string | null; checked_on: string; notes: string | null; created_at: string }
interface Release { id: string; itp_point_id: string; released_at: string; released_by_name: string; authority: string | null; note: string | null }
interface Ncr { id: string; seq: number; itp_point_id: string | null; status: NcrStatus; disposition: Disposition | null; observation: string }
interface Equipment { id: string; name: string; serial_no: string | null; active: boolean; equipment_calibrations: Array<{ calibrated_on: string; due_on: string; certificate_no: string }> }

interface Props { lot: Lot; points: Point[]; checks: Check[]; releases: Release[]; ncrs: Ncr[]; equipment: Equipment[]; today: string; canRun: boolean }

const perthDay = (iso: string) => new Date(Date.parse(iso) + 8 * 3_600_000).toISOString().slice(0, 10);
const perthClock = (iso: string) => new Date(Date.parse(iso) + 8 * 3_600_000).toISOString().slice(11, 16);

/**
 * A lot, point by point: the result of every check, the hold points released
 * and by whom, and what still stands between it and closing. Checks and
 * releases are records — once saved they stand — and the database refuses the
 * same things this screen does, so the two cannot drift apart unnoticed.
 */
export function LotScreen({ lot, points, checks, releases, ncrs, equipment, today, canRun }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState<string | null>(null);
  const [releasing, setReleasing] = useState<string | null>(null);
  const [form, setForm] = useState({ result: 'conforms' as Result, measured: '', testRef: '', equipmentId: '', checkedOn: today, notes: '' });
  const [rel, setRel] = useState({ by: '', authority: '', note: '' });
  const [closeNote, setCloseNote] = useState('');

  const released = new Set(releases.map((r) => r.itp_point_id));
  const latest = latestChecks(checks);
  const problems = lotCloseProblems(points, checks, released, ncrs);
  const testing = testingAllowed(lot.status, ncrs);
  const reworkNcr = ncrs.find((n) => n.status !== 'open' && n.disposition === 'rework');

  async function act(key: string, fn: () => Promise<void>) {
    setBusy(key);
    setError(null);
    try { await fn(); router.refresh(); } catch (err) { setError(err instanceof Error ? err.message : 'That did not save.'); } finally { setBusy(null); }
  }

  return (
    <>
      {error && <p className="alert" role="alert">{error}</p>}

      <div className={`item${lot.status === 'nonconforming' ? ' item--warn' : ''}`}>
        <p className="label">{LOT_STATUS_LABEL[lot.status]}</p>
        {lot.surveyedPosition && <p className="caption">Surveyed position: {lot.surveyedPosition}</p>}
        {lot.status === 'nonconforming' && (
          <p className="caption vr-missing">
            {ncrs.length === 0 ? 'On hold. Raise a non-conformance before anything more is tested.'
              : ncrs.some((n) => n.status === 'open') ? 'On hold until the corrective action is approved.'
                : 'Corrective action approved: re-test, then close the non-conformance to lift the hold.'}
          </p>
        )}
        {lot.status === 'conforming' && lot.closeNote && <p className="caption">{lot.closeNote}</p>}
        {(lot.status === 'open' || lot.status === 'nonconforming') && problems.length > 0 && (
          <ul className="gaplist">{problems.map((p) => <li key={p} className="caption">{p}</li>)}</ul>
        )}
      </div>

      {ncrs.length > 0 && (
        <>
          <p className="label" style={{ marginTop: '1rem' }}>Non-conformances on this lot</p>
          <ul className="gaplist">
            {ncrs.map((n) => (
              <li key={n.id}><Link href={`/quality/ncr/${n.id}?project=${lot.projectId}`}>{ncrRef(n.seq)}</Link> · {NCR_STATUS_LABEL[n.status]} · {n.observation.length > 60 ? `${n.observation.slice(0, 60)}…` : n.observation}</li>
            ))}
          </ul>
        </>
      )}

      <p className="label" style={{ marginTop: '1rem' }}>Points</p>
      <div className="itp__points">
        {points.map((pt) => {
          const history = checks.filter((c) => c.itp_point_id === pt.id).sort((a, b) => b.created_at.localeCompare(a.created_at));
          const last = latest.get(pt.id);
          const release = releases.find((r) => r.itp_point_id === pt.id);
          const usable = equipment.filter((e) => calibratedOn(e.equipment_calibrations, form.checkedOn));
          const canRelease = canRun && pt.point_type === 'hold' && !release && lot.status === 'open' && last?.result === 'conforms';
          return (
            <div key={pt.id} className={`item itp__point${pt.point_type === 'hold' ? ' itp__point--hold' : ''}`}>
              <p className="label">{pt.seq}. {pt.activity} · {POINT_TYPE_LABEL[pt.point_type]}</p>
              <p style={{ margin: '0.2rem 0 0', fontWeight: 600 }}>{pt.inspection_test}</p>
              <p className="caption">Accept: {pt.acceptance_criteria} · {pt.frequency}</p>
              <p className={`caption${last?.result === 'does_not_conform' ? ' vr-missing' : ''}`} style={{ fontWeight: 600 }}>
                {last ? `${RESULT_LABEL[last.result]}${last.measured ? ` — ${last.measured}` : ''}` : 'No result yet'}
              </p>
              {pt.point_type === 'hold' && (
                <p className={`caption${release ? '' : ' vr-missing'}`}>
                  {release ? `Released ${fmtDate(perthDay(release.released_at))} ${perthClock(release.released_at)} by ${release.released_by_name}${release.authority ? `, ${release.authority}` : ''}` : 'Hold point — work beyond it stops until released'}
                </p>
              )}
              {history.length > 0 && (
                <details><summary className="caption">Every check ({history.length})</summary>
                  <ul className="gaplist">
                    {history.map((c) => (
                      <li key={c.id} className="caption">
                        {fmtDate(c.checked_on)} · {RESULT_LABEL[c.result]}{c.measured ? ` · ${c.measured}` : ''}{c.test_reference ? ` · test ${c.test_reference}` : ''}
                        {c.equipment_id ? ` · ${equipment.find((e) => e.id === c.equipment_id)?.name ?? 'equipment'}` : ''}{c.notes ? ` · ${c.notes}` : ''}
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              {canRun && testing && checking !== pt.id && (
                <button type="button" className="linklike" onClick={() => { setChecking(pt.id); setForm({ result: 'conforms', measured: '', testRef: '', equipmentId: '', checkedOn: today, notes: '' }); }}>Record a check</button>
              )}
              {checking === pt.id && (
                <div className="regpanel__form">
                  <div className="signin__grid">
                    <label className="fieldcell"><span className="label">Result</span>
                      <select className="field field--sm" id="chk-result" value={form.result} onChange={(e) => setForm({ ...form, result: e.target.value as Result })}>
                        {RESULTS.map((r) => <option key={r} value={r}>{RESULT_LABEL[r]}</option>)}
                      </select></label>
                    <label className="fieldcell"><span className="label">On</span>
                      <input className="field field--sm" id="chk-date" type="date" value={form.checkedOn} max={today} onChange={(e) => setForm({ ...form, checkedOn: e.target.value })} /></label>
                  </div>
                  <div className="signin__grid">
                    <label className="fieldcell"><span className="label">Measured</span>
                      <input className="field field--sm" id="chk-measured" value={form.measured} placeholder="98.6% MDD" onChange={(e) => setForm({ ...form, measured: e.target.value })} /></label>
                    <label className="fieldcell"><span className="label">Test report</span>
                      <input className="field field--sm" id="chk-ref" value={form.testRef} placeholder="Lab report number" onChange={(e) => setForm({ ...form, testRef: e.target.value })} /></label>
                  </div>
                  {pt.uses_calibrated_equipment && (
                    <label className="fieldcell"><span className="label">Calibrated equipment used</span>
                      <select className="field field--sm" id="chk-equipment" value={form.equipmentId} onChange={(e) => setForm({ ...form, equipmentId: e.target.value })}>
                        <option value="">Choose…</option>
                        {usable.map((e) => <option key={e.id} value={e.id}>{e.name}{e.serial_no ? ` (${e.serial_no})` : ''}</option>)}
                      </select>
                      {usable.length === 0 && <span className="caption vr-missing">Nothing in the calibration register is in calibration on that day.</span>}
                    </label>
                  )}
                  <label className="fieldcell"><span className="label">Notes</span>
                    <input className="field field--sm" id="chk-notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
                  <button type="button" className="button" disabled={busy !== null || (pt.uses_calibrated_equipment && !form.equipmentId)} onClick={() => void act('check', async () => {
                    const { error: e } = await createClient().from('lot_checks').insert({
                      lot_id: lot.id, itp_point_id: pt.id, result: form.result, measured: form.measured.trim() || null,
                      test_reference: form.testRef.trim() || null, equipment_id: form.equipmentId || null, checked_on: form.checkedOn, notes: form.notes.trim() || null,
                    });
                    if (e) throw new Error(e.message);
                    setChecking(null);
                  })}>{busy === 'check' ? 'Saving…' : 'Save the check'}</button>
                  <button type="button" className="linklike" onClick={() => setChecking(null)}>Cancel</button>
                  {form.result === 'does_not_conform' && <p className="caption vr-missing">This puts the lot on hold. Raise a non-conformance next.</p>}
                </div>
              )}

              {canRelease && releasing !== pt.id && <button type="button" className="linklike" onClick={() => { setReleasing(pt.id); setRel({ by: '', authority: '', note: '' }); }}>Record the release</button>}
              {releasing === pt.id && (
                <div className="regpanel__form">
                  <label className="fieldcell"><span className="label">Released by</span>
                    <input className="field field--sm" id="rel-by" value={rel.by} placeholder="The person with authority to release it" onChange={(e) => setRel({ ...rel, by: e.target.value })} /></label>
                  <div className="signin__grid">
                    <label className="fieldcell"><span className="label">Their role</span>
                      <input className="field field--sm" id="rel-authority" value={rel.authority} placeholder="Head contractor's representative" onChange={(e) => setRel({ ...rel, authority: e.target.value })} /></label>
                    <label className="fieldcell"><span className="label">Note</span>
                      <input className="field field--sm" id="rel-note" value={rel.note} onChange={(e) => setRel({ ...rel, note: e.target.value })} /></label>
                  </div>
                  <button type="button" className="button" disabled={busy !== null || !rel.by.trim()} onClick={() => void act('release', async () => {
                    const { error: e } = await createClient().from('hold_point_releases').insert({
                      lot_id: lot.id, itp_point_id: pt.id, released_at: new Date().toISOString(), released_by_name: rel.by.trim(),
                      authority: rel.authority.trim() || null, note: rel.note.trim() || null,
                    });
                    if (e) throw new Error(e.message);
                    setReleasing(null);
                  })}>{busy === 'release' ? 'Saving…' : 'Record the release'}</button>
                  <button type="button" className="linklike" onClick={() => setReleasing(null)}>Cancel</button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {canRun && (lot.status === 'open' || lot.status === 'nonconforming') && (
        <RaiseNcrForm projectId={lot.projectId} lotId={lot.id} points={points.map((p) => ({ id: p.id, label: `${p.seq}. ${p.inspection_test}` }))} />
      )}

      {canRun && lot.status === 'nonconforming' && reworkNcr && !lot.hasReplacement && (
        <div className="item" style={{ marginTop: '0.75rem' }}>
          <p className="label">Rework</p>
          <p className="caption">{ncrRef(reworkNcr.seq)} is to be reworked. The rework is a new lot, re-numbered and cross-referenced to this one, which is then marked replaced.</p>
          <button type="button" className="button" disabled={busy !== null} onClick={() => void act('rework', async () => {
            const { data, error: e } = await createClient().from('lots').insert({
              project_id: lot.projectId, itp_id: lot.itpId, description: `${lot.description} — rework`, location: lot.location,
              surveyed_position: lot.surveyedPosition, replaces_lot_id: lot.id, seq: 0,
            }).select('id').single();
            if (e) throw new Error(e.message);
            router.push(`/quality/lot/${data.id}?project=${lot.projectId}`);
          })}>{busy === 'rework' ? 'Opening…' : 'Open the rework lot'}</button>
        </div>
      )}

      {canRun && lot.status === 'open' && (
        <div className="item" style={{ marginTop: '0.75rem' }}>
          <p className="label">Close the lot</p>
          {problems.length > 0 ? <p className="caption">It closes once everything above is resolved.</p> : (
            <>
              <label className="fieldcell"><span className="label">Close-out note</span>
                <input className="field field--sm" id="lot-close-note" value={closeNote} placeholder="All points conform; hold points released" onChange={(e) => setCloseNote(e.target.value)} /></label>
              <button type="button" className="button" disabled={busy !== null} onClick={() => void act('close', async () => {
                const { error: e } = await createClient().from('lots').update({ status: 'conforming', close_note: closeNote.trim() || null }).eq('id', lot.id);
                if (e) throw new Error(e.message);
              })}>{busy === 'close' ? 'Closing…' : 'Close as conforming'}</button>
              <p className="caption">Once closed the lot does not change.</p>
            </>
          )}
        </div>
      )}
    </>
  );
}
