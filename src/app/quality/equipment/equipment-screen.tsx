'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { fmtDate } from '@/lib/pdf/dates';
import { addMonths } from '@/lib/obligations/model';
import { calibrationStatus, CALIBRATION_LABEL } from '@/lib/quality/model';

interface Cal { id: string; calibrated_on: string; due_on: string; certificate_no: string; calibrated_by: string | null }
interface Item { id: string; name: string; serial_no: string | null; kind: string | null; calibration_interval_months: number | null; active: boolean; equipment_calibrations: Cal[] }

export function EquipmentScreen({ orgId, equipment, today, canManage }: { orgId: string; equipment: Item[]; today: string; canManage: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [n, setN] = useState({ name: '', serial: '', kind: '', interval: '12' });
  const [calFor, setCalFor] = useState<string | null>(null);
  const [c, setC] = useState({ on: today, due: '', cert: '', by: '' });

  async function act(key: string, fn: () => Promise<void>) {
    setBusy(key);
    setError(null);
    try { await fn(); router.refresh(); } catch (err) { setError(err instanceof Error ? err.message : 'That did not save.'); } finally { setBusy(null); }
  }

  return (
    <>
      {error && <p className="alert" role="alert">{error}</p>}
      {equipment.length === 0 ? <p className="nil">Nothing on the register.</p> : (
        <div className="itp__points">
          {equipment.map((e) => {
            const st = calibrationStatus(e.equipment_calibrations, today);
            const history = [...e.equipment_calibrations].sort((a, b) => b.calibrated_on.localeCompare(a.calibrated_on));
            return (
              <div key={e.id} className={`item${st.status === 'expired' || st.status === 'none' ? ' item--warn' : ''}`}>
                <p className="label">{e.name}{e.serial_no ? ` · ${e.serial_no}` : ''}{e.kind ? ` · ${e.kind}` : ''}{e.active ? '' : ' · retired'}</p>
                <p style={{ margin: '0.2rem 0 0', fontWeight: 600 }} className={st.status === 'expired' || st.status === 'none' ? 'vr-missing' : undefined}>
                  {CALIBRATION_LABEL[st.status]}{st.latest ? ` · due ${fmtDate(st.latest.due_on)}` : ''}
                </p>
                {history.length > 0 && (
                  <ul className="gaplist">
                    {history.map((h) => <li key={h.id} className="caption">{fmtDate(h.calibrated_on)} to {fmtDate(h.due_on)} · certificate {h.certificate_no}{h.calibrated_by ? ` · ${h.calibrated_by}` : ''}</li>)}
                  </ul>
                )}
                {canManage && e.active && calFor !== e.id && (
                  <button type="button" className="linklike" onClick={() => { setCalFor(e.id); setC({ on: today, due: e.calibration_interval_months ? addMonths(today, e.calibration_interval_months) : '', cert: '', by: '' }); }}>Record a calibration</button>
                )}
                {calFor === e.id && (
                  <div className="regpanel__form">
                    <div className="signin__grid">
                      <label className="fieldcell"><span className="label">Calibrated on</span>
                        <input className="field field--sm" id="cal-on" type="date" value={c.on} max={today} onChange={(ev) => setC({ ...c, on: ev.target.value })} /></label>
                      <label className="fieldcell"><span className="label">Due</span>
                        <input className="field field--sm" id="cal-due" type="date" value={c.due} onChange={(ev) => setC({ ...c, due: ev.target.value })} /></label>
                    </div>
                    <div className="signin__grid">
                      <label className="fieldcell"><span className="label">Certificate</span>
                        <input className="field field--sm" id="cal-cert" value={c.cert} placeholder="Certificate number" onChange={(ev) => setC({ ...c, cert: ev.target.value })} /></label>
                      <label className="fieldcell"><span className="label">By</span>
                        <input className="field field--sm" id="cal-by" value={c.by} placeholder="Laboratory, NATA accreditation" onChange={(ev) => setC({ ...c, by: ev.target.value })} /></label>
                    </div>
                    <button type="button" className="button" disabled={busy !== null || !c.cert.trim() || !c.due || c.due <= c.on} onClick={() => void act('cal', async () => {
                      const { error: er } = await createClient().from('equipment_calibrations').insert({ equipment_id: e.id, calibrated_on: c.on, due_on: c.due, certificate_no: c.cert.trim(), calibrated_by: c.by.trim() || null });
                      if (er) throw new Error(er.message);
                      setCalFor(null);
                    })}>{busy === 'cal' ? 'Saving…' : 'Save the calibration'}</button>
                    <button type="button" className="linklike" onClick={() => setCalFor(null)}>Cancel</button>
                  </div>
                )}
                {canManage && (
                  <p><button type="button" className="linklike" disabled={busy !== null} onClick={() => void act(`active:${e.id}`, async () => {
                    const { error: er } = await createClient().from('measuring_equipment').update({ active: !e.active }).eq('id', e.id);
                    if (er) throw new Error(er.message);
                  })}>{e.active ? 'Retire' : 'Bring back'}</button></p>
                )}
              </div>
            );
          })}
        </div>
      )}
      {canManage && (!adding ? (
        <button type="button" className="button button--quiet" style={{ marginTop: '0.75rem' }} onClick={() => setAdding(true)}>Add equipment</button>
      ) : (
        <div className="item" style={{ marginTop: '0.75rem' }}>
          <div className="signin__grid">
            <label className="fieldcell"><span className="label">Name</span>
              <input className="field field--sm" id="eq-name" value={n.name} placeholder="Nuclear density gauge" onChange={(e) => setN({ ...n, name: e.target.value })} /></label>
            <label className="fieldcell"><span className="label">Serial</span>
              <input className="field field--sm" id="eq-serial" value={n.serial} onChange={(e) => setN({ ...n, serial: e.target.value })} /></label>
          </div>
          <div className="signin__grid">
            <label className="fieldcell"><span className="label">Kind</span>
              <input className="field field--sm" id="eq-kind" value={n.kind} placeholder="Density, level, torque" onChange={(e) => setN({ ...n, kind: e.target.value })} /></label>
            <label className="fieldcell fieldcell--narrow"><span className="label">Calibrate every (months)</span>
              <input className="field field--sm" id="eq-interval" inputMode="numeric" value={n.interval} onChange={(e) => setN({ ...n, interval: e.target.value })} /></label>
          </div>
          <button type="button" className="button" disabled={busy !== null || !n.name.trim()} onClick={() => void act('add', async () => {
            const months = n.interval.trim() === '' ? null : Number(n.interval);
            const { error: er } = await createClient().from('measuring_equipment').insert({ org_id: orgId, name: n.name.trim(), serial_no: n.serial.trim() || null, kind: n.kind.trim() || null, calibration_interval_months: months });
            if (er) throw new Error(er.message);
            setAdding(false); setN({ name: '', serial: '', kind: '', interval: '12' });
          })}>{busy === 'add' ? 'Adding…' : 'Add'}</button>
          <button type="button" className="linklike" onClick={() => setAdding(false)}>Cancel</button>
        </div>
      ))}
    </>
  );
}
