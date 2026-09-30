'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { addMonths } from '@/lib/obligations/model';
import { calibrationRegister, fmtDay, type EquipmentRow } from '@/lib/registers/model';
import { Field, Messages, Verdict, blankToNull, readMonths, useSave } from './shared';

interface Draft { name: string; serial: string; kind: string; interval: string; active: boolean }
interface CalDraft { on: string; due: string; cert: string; by: string }

const draftOf = (e: EquipmentRow | null): Draft => ({
  name: e?.name ?? '', serial: e?.serial_no ?? '', kind: e?.kind ?? '',
  interval: e ? (e.calibration_interval_months != null ? String(e.calibration_interval_months) : '') : '12', active: e?.active ?? true,
});

/**
 * The calibration register, edited in place (README R118). The equipment's
 * details change here; a calibration is a record — it is added, with its
 * certificate, and then it stands. A wrong one is answered by recording the
 * right one, not by editing the first.
 */
export function CalibrationEditor({ orgId, today, userId, equipment }: { orgId: string; today: string; userId: string; equipment: EquipmentRow[] }) {
  const save = useSave();
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(draftOf(null));
  const [calFor, setCalFor] = useState<string | null>(null);
  const [cal, setCal] = useState<CalDraft>({ on: today, due: '', cert: '', by: '' });
  const sorted = equipment.slice().sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const edit = (e: EquipmentRow | null) => { setDraft(draftOf(e)); setOpen(e ? e.id : 'new'); setCalFor(null); save.setError(null); };

  async function commit(e: EquipmentRow | null) {
    await save.run(e ? e.id : 'new', async () => {
      if (!draft.name.trim()) throw new Error('Give the equipment a name.');
      const supabase = createClient();
      const facts = { name: draft.name.trim(), serial_no: blankToNull(draft.serial), kind: blankToNull(draft.kind), calibration_interval_months: readMonths(draft.interval), active: draft.active };
      const clash = (m: string) => (/duplicate|unique/i.test(m) ? `${facts.name}${facts.serial_no ? ` (${facts.serial_no})` : ''} is already on the register.` : m);
      if (e) {
        const { error } = await supabase.from('measuring_equipment').update(facts).eq('id', e.id);
        if (error) throw new Error(clash(error.message));
      } else {
        const { error } = await supabase.from('measuring_equipment').insert({ ...facts, org_id: orgId, created_by: userId });
        if (error) throw new Error(clash(error.message));
      }
      setOpen(null);
      return e ? `${facts.name} saved.` : `${facts.name} added. Record its calibration next.`;
    });
  }

  async function commitCal(e: EquipmentRow) {
    const ok = await save.run(`cal:${e.id}`, async () => {
      if (!cal.cert.trim()) throw new Error('Put in the certificate number.');
      if (!cal.on || cal.on > today) throw new Error('The calibration date is today or earlier.');
      if (!cal.due || cal.due <= cal.on) throw new Error('The due date comes after the calibration date.');
      const { error } = await createClient().from('equipment_calibrations').insert({ equipment_id: e.id, calibrated_on: cal.on, due_on: cal.due, certificate_no: cal.cert.trim(), calibrated_by: blankToNull(cal.by) });
      if (error) throw new Error(error.message);
      return `Calibration recorded for ${e.name}, due ${fmtDay(cal.due)}.`;
    });
    if (ok) setCalFor(null);
  }

  const form = (e: EquipmentRow | null) => (
    <div className="regs__form">
      <div className="regs__fields">
        <Field label="Equipment" wide><input className="field field--sm" value={draft.name} placeholder="Nuclear density gauge" onChange={(ev) => set('name', ev.target.value)} /></Field>
        <Field label="Serial no."><input className="field field--sm" value={draft.serial} onChange={(ev) => set('serial', ev.target.value)} /></Field>
        <Field label="Kind"><input className="field field--sm" value={draft.kind} placeholder="Density, level, torque" onChange={(ev) => set('kind', ev.target.value)} /></Field>
        <Field label="Calibrate every (months)"><input className="field field--sm" inputMode="numeric" value={draft.interval} onChange={(ev) => set('interval', ev.target.value)} /></Field>
        <Field label="In use">
          <select className="field field--sm" value={draft.active ? 'yes' : 'no'} onChange={(ev) => set('active', ev.target.value === 'yes')}>
            <option value="yes">In use</option>
            <option value="no">Retired — kept for the record</option>
          </select>
        </Field>
      </div>
      <div className="regs__actions">
        <button type="button" className="button" disabled={save.busy !== null} onClick={() => void commit(e)}>{save.busy ? 'Saving…' : e ? 'Save' : 'Add to the register'}</button>
        <button type="button" className="linklike" onClick={() => setOpen(null)}>Cancel</button>
      </div>
    </div>
  );

  return (
    <div className="regs__list">
      <Messages error={save.error} notice={save.notice} />
      {sorted.length === 0 && <p className="nil">No measuring equipment on the register yet.</p>}
      {sorted.map((e) => {
        const row = calibrationRegister([{ ...e, active: true }], today).sections[0].rows[0];
        const history = e.calibrations.slice().sort((a, b) => b.calibrated_on.localeCompare(a.calibrated_on));
        return (
          <div key={e.id} className={`item regs__row${e.active ? '' : ' regs__row--retired'}`}>
            <div className="regs__head">
              <div>
                <p className="regs__name">{e.name}{e.active ? '' : ' · retired'}</p>
                <p className="caption regs__meta">{[e.serial_no ? `Serial ${e.serial_no}` : 'No serial number', e.kind, `Interval ${row[2].text.toLowerCase()}`].filter(Boolean).join(' · ')}</p>
              </div>
              {open !== e.id && <button type="button" className="button button--quiet regs__edit" onClick={() => edit(e)}>Edit</button>}
            </div>
            <div className="regs__facts">
              <Verdict label="Last calibrated" cell={row[3]} />
              <Verdict label="Certificate" cell={row[4]} />
              <Verdict label="Due" cell={row[5]} />
              <Verdict label="Status" cell={row[6]} />
            </div>
            {history.length > 1 && (
              <ul className="gaplist">
                {history.slice(1).map((h, i) => <li key={`${h.certificate_no}-${i}`} className="caption">{fmtDay(h.calibrated_on)} to {fmtDay(h.due_on)} · certificate {h.certificate_no}{h.calibrated_by ? ` · ${h.calibrated_by}` : ''}</li>)}
              </ul>
            )}
            {open === e.id && form(e)}
            {open !== e.id && calFor !== e.id && e.active && (
              <p className="regs__links">
                <button type="button" className="linklike" onClick={() => { setCalFor(e.id); setOpen(null); save.setError(null); setCal({ on: today, due: e.calibration_interval_months ? addMonths(today, e.calibration_interval_months) : '', cert: '', by: '' }); }}>Record a calibration</button>
              </p>
            )}
            {calFor === e.id && (
              <div className="regs__form">
                <div className="regs__fields">
                  <Field label="Calibrated on"><input className="field field--sm" type="date" max={today} value={cal.on} onChange={(ev) => setCal({ ...cal, on: ev.target.value, due: e.calibration_interval_months && ev.target.value ? addMonths(ev.target.value, e.calibration_interval_months) : cal.due })} /></Field>
                  <Field label="Due"><input className="field field--sm" type="date" value={cal.due} onChange={(ev) => setCal({ ...cal, due: ev.target.value })} /></Field>
                  <Field label="Certificate no."><input className="field field--sm" value={cal.cert} onChange={(ev) => setCal({ ...cal, cert: ev.target.value })} /></Field>
                  <Field label="Calibrated by"><input className="field field--sm" value={cal.by} placeholder="Laboratory, NATA accreditation" onChange={(ev) => setCal({ ...cal, by: ev.target.value })} /></Field>
                </div>
                <div className="regs__actions">
                  <button type="button" className="button" disabled={save.busy !== null} onClick={() => void commitCal(e)}>{save.busy ? 'Saving…' : 'Record the calibration'}</button>
                  <button type="button" className="linklike" onClick={() => setCalFor(null)}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        );
      })}
      {open === 'new'
        ? <div className="item regs__row"><p className="regs__name">New equipment</p>{form(null)}</div>
        : <button type="button" className="button button--quiet" onClick={() => edit(null)}>Add equipment</button>}
    </div>
  );
}
