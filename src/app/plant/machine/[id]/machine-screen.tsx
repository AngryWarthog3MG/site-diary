'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { fmtDate } from '@/lib/pdf/dates';
import {
  INSPECTION_BASES, BASIS_LABEL, RECORD_KINDS, RECORD_KIND_LABEL, OUTCOMES, OUTCOME_LABEL, REGISTRATION_LABEL,
  nextInspection, registrationStatus, mayNotBeUsed, intervalMonths,
  type InspectionBasis, type RecordKind, type Outcome, type PlantFacts,
} from '@/lib/plant/inspections';
import { dueStatus, STATUS_LABEL } from '@/lib/obligations/model';

interface Machine extends PlantFacts {
  id: string;
  orgId: string;
  registration_kind: 'item' | 'design' | null;
}

interface RecordRow {
  id: string;
  kind: RecordKind;
  done_on: string;
  performed_by_name: string;
  competence: string | null;
  organisation: string | null;
  hour_meter: number | null;
  outcome: Outcome | null;
  findings: string | null;
  next_due_on: string | null;
  file_path: string | null;
  created_at: string;
}

interface Props {
  machine: Machine;
  records: RecordRow[];
  today: string;
  canEdit: boolean;
}

export function MachineScreen({ machine, records, today, canEdit }: Props) {
  const router = useRouter();
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // The basis and the registration, editable. These are facts about the machine, not records.
  const [basis, setBasis] = useState<InspectionBasis | ''>(machine.inspection_basis ?? '');
  const [interval, setIntervalText] = useState(machine.inspection_interval_months == null ? '' : String(machine.inspection_interval_months));
  const [regRequired, setRegRequired] = useState(machine.registration_required);
  const [regKind, setRegKind] = useState<'item' | 'design'>(machine.registration_kind ?? 'item');
  const [regNo, setRegNo] = useState(machine.registration_no ?? '');
  const [regExpires, setRegExpires] = useState(machine.registration_expires_on ?? '');

  // A new record.
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<RecordKind>('inspection');
  const [doneOn, setDoneOn] = useState(today);
  const [by, setBy] = useState('');
  const [competence, setCompetence] = useState('');
  const [organisation, setOrganisation] = useState('');
  const [hours, setHours] = useState('');
  const [outcome, setOutcome] = useState<Outcome | ''>('');
  const [findings, setFindings] = useState('');
  const [nextDue, setNextDue] = useState('');
  const [file, setFile] = useState<File | null>(null);

  const inspection = nextInspection(machine, records);
  const inspDue = inspection.state === 'scheduled' ? inspection.due : null;
  const inspStatus = inspection.state === 'never_inspected' ? 'overdue' : inspDue ? dueStatus(inspDue, today) : null;
  const reg = registrationStatus(machine, today);
  const blocked = mayNotBeUsed(reg);

  useEffect(() => {
    const paths = records.map((r) => r.file_path).filter((p): p is string => Boolean(p));
    if (paths.length === 0) return;
    let cancelled = false;
    void (async () => {
      const { data } = await createClient().storage.from('plant-records').createSignedUrls(paths, 3600);
      if (cancelled || !data) return;
      const next: Record<string, string> = {};
      for (const row of data) if (row.path && row.signedUrl) next[row.path] = row.signedUrl;
      setUrls(next);
    })();
    return () => { cancelled = true; };
  }, [records]);

  async function saveFacts() {
    const months = interval.trim() === '' ? null : Number(interval);
    if (months != null && (!Number.isInteger(months) || months < 1 || months > 60)) { setError('The interval is a whole number of months, 1 to 60, or blank.'); return; }
    // Saved either way; the warning says why the machine will now be blocked.
    setError(regRequired && !regNo.trim() ? 'Saved without a registration number, so this machine cannot be prestarted until one is recorded.' : null);
    setBusy('facts');
    setNotice(null);
    try {
      const { error: e } = await createClient().from('plant_register').update({
        inspection_basis: basis || null,
        inspection_interval_months: months,
        registration_required: regRequired,
        registration_kind: regRequired ? regKind : null,
        registration_no: regRequired ? (regNo.trim() || null) : null,
        registration_expires_on: regRequired ? (regExpires || null) : null,
      }).eq('id', machine.id);
      if (e) throw new Error(e.message);
      setNotice('Saved.');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not save.');
    } finally {
      setBusy(null);
    }
  }

  async function addRecord() {
    if (!by.trim()) { setError('Name who did it — the competent person.'); return; }
    const h = hours.trim() === '' ? null : Number(hours);
    if (h != null && (!Number.isFinite(h) || h < 0)) { setError('The hour meter is a number, or leave it blank.'); return; }
    setBusy('record');
    setError(null);
    setNotice(null);
    const supabase = createClient();
    const id = crypto.randomUUID();
    let filePath: string | null = null;
    try {
      if (file) {
        const ext = (file.name.split('.').pop() ?? 'pdf').toLowerCase().replace(/[^a-z0-9]/g, '') || 'pdf';
        filePath = `${machine.orgId}/${machine.id}/${id}.${ext}`;
        const { error: upErr } = await supabase.storage.from('plant-records').upload(filePath, file, { contentType: file.type || 'application/pdf', upsert: false });
        if (upErr) throw new Error(`The file did not upload: ${upErr.message}`);
      }
      const { error: e } = await supabase.from('plant_maintenance_records').insert({
        id, plant_id: machine.id, kind, done_on: doneOn,
        performed_by_name: by.trim(), competence: competence.trim() || null, organisation: organisation.trim() || null,
        hour_meter: h, outcome: outcome || null, findings: findings.trim() || null,
        next_due_on: nextDue || null, file_path: filePath,
      });
      if (e) {
        if (filePath) await supabase.storage.from('plant-records').remove([filePath]).catch(() => undefined);
        throw new Error(e.message);
      }
      setAdding(false); setBy(''); setCompetence(''); setOrganisation(''); setHours(''); setOutcome(''); setFindings(''); setNextDue(''); setFile(null);
      setNotice('Recorded.');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not save.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      {error && <p className="alert" role="alert">{error}</p>}
      {notice && <p className="notice">{notice}</p>}

      {blocked && (
        <p className="alert" role="alert">
          <strong>Do not use.</strong> {REGISTRATION_LABEL[reg]}. Plant that must be registered may not be used until it is
          (WHS Act 2020 (WA) s. 42), and it cannot be prestarted in this app.
        </p>
      )}

      <div className={`item${inspStatus === 'overdue' ? ' item--warn' : ''}`}>
        <p className="label">Inspection</p>
        <p style={{ margin: '0.3rem 0 0', fontWeight: 600 }} className={inspStatus === 'overdue' ? 'vr-missing' : undefined}>
          {inspection.state === 'not_scheduled' && 'No inspection basis set'}
          {inspection.state === 'never_inspected' && 'No inspection on record'}
          {inspection.state === 'scheduled' && `${STATUS_LABEL[inspStatus!]} · next due ${fmtDate(inspection.due)}${inspection.from === 'inspector' ? ' (as the inspector set)' : ''}`}
        </p>
        <p className="caption">
          {machine.inspection_basis ? BASIS_LABEL[machine.inspection_basis] : 'Set the basis below: the manufacturer, a competent person, or annually.'}
          {intervalMonths(machine) ? ` · every ${intervalMonths(machine)} months` : ''}
        </p>
        <p className="caption">{REGISTRATION_LABEL[reg]}{machine.registration_no ? ` · ${machine.registration_no}` : ''}{machine.registration_expires_on ? ` · expires ${fmtDate(machine.registration_expires_on)}` : ''}</p>
      </div>

      {canEdit && (
        <details className="item" style={{ marginTop: '0.9rem' }} open={!machine.inspection_basis}>
          <summary className="label" style={{ cursor: 'pointer' }}>How this machine is inspected, and registration</summary>
          <label className="fieldcell">
            <span className="label">Inspected on the basis of</span>
            <select className="field field--sm" id="m-basis" value={basis} onChange={(e) => setBasis(e.target.value as InspectionBasis | '')}>
              <option value="">Not set</option>
              {INSPECTION_BASES.map((b) => <option key={b} value={b}>{BASIS_LABEL[b]}</option>)}
            </select>
          </label>
          <label className="fieldcell fieldcell--narrow">
            <span className="label">Every (months)</span>
            <input className="field field--sm" id="m-interval" inputMode="numeric" value={interval} placeholder={basis === 'annual' ? '12' : 'As recommended'} onChange={(e) => setIntervalText(e.target.value)} />
          </label>
          <label className={`checkrow${regRequired ? ' checkrow--on' : ''}`}>
            <input type="checkbox" id="m-reg-required" checked={regRequired} onChange={(e) => setRegRequired(e.target.checked)} />
            <span>This machine must be registered — a tower crane, a mobile crane over 10 t, a concrete placing boom, a boiler or pressure vessel. Most civil plant does not.</span>
          </label>
          {regRequired && (
            <div className="signin__grid">
              <label className="fieldcell fieldcell--narrow">
                <span className="label">Registered</span>
                <select className="field field--sm" id="m-reg-kind" value={regKind} onChange={(e) => setRegKind(e.target.value as 'item' | 'design')}>
                  <option value="item">The item</option>
                  <option value="design">The design</option>
                </select>
              </label>
              <label className="fieldcell">
                <span className="label">Registration number</span>
                <input className="field field--sm" id="m-reg-no" value={regNo} onChange={(e) => setRegNo(e.target.value)} />
              </label>
              <label className="fieldcell">
                <span className="label">Expires</span>
                <input className="field field--sm" id="m-reg-expires" type="date" value={regExpires} onChange={(e) => setRegExpires(e.target.value)} />
              </label>
            </div>
          )}
          <button type="button" className="button" disabled={busy !== null} onClick={() => void saveFacts()}>{busy === 'facts' ? 'Saving…' : 'Save'}</button>
        </details>
      )}

      <hr className="rule" />
      <p className="label">Inspections, tests and repairs</p>
      <p className="caption">Kept for as long as the machine is used (reg. 237). Each names who did it and on what competence.</p>
      {records.length === 0 ? (
        <p className="nil">Nothing on record.</p>
      ) : (
        <ul className="gaplist">
          {records.map((r) => (
            <li key={r.id}>
              <strong>{fmtDate(r.done_on)}</strong> · {RECORD_KIND_LABEL[r.kind]}{r.outcome ? ` · ${OUTCOME_LABEL[r.outcome]}` : ''}
              {r.hour_meter != null ? ` · ${r.hour_meter} h` : ''}
              <br />
              <span className="caption">
                {r.performed_by_name}{r.organisation ? `, ${r.organisation}` : ''}{r.competence ? ` · ${r.competence}` : ''}
                {r.next_due_on ? ` · next due ${fmtDate(r.next_due_on)}` : ''}
                {r.file_path && urls[r.file_path] ? <> · <a href={urls[r.file_path]} target="_blank" rel="noopener">report</a></> : ''}
              </span>
              {r.findings && <><br /><span className="caption">{r.findings}</span></>}
            </li>
          ))}
        </ul>
      )}

      {canEdit && (!adding ? (
        <button type="button" className="button button--quiet" onClick={() => setAdding(true)}>Record an inspection, test or repair</button>
      ) : (
        <div className="item" style={{ marginTop: '0.75rem' }}>
          <div className="signin__grid">
            <label className="fieldcell">
              <span className="label">What</span>
              <select className="field field--sm" id="r-kind" value={kind} onChange={(e) => setKind(e.target.value as RecordKind)}>
                {RECORD_KINDS.map((k) => <option key={k} value={k}>{RECORD_KIND_LABEL[k]}</option>)}
              </select>
            </label>
            <label className="fieldcell">
              <span className="label">Done on</span>
              <input className="field field--sm" id="r-done" type="date" value={doneOn} max={today} onChange={(e) => setDoneOn(e.target.value)} />
            </label>
          </div>
          <label className="fieldcell">
            <span className="label">Who did it</span>
            <input className="field field--sm" id="r-by" value={by} placeholder="The competent person" onChange={(e) => setBy(e.target.value)} />
          </label>
          <div className="signin__grid">
            <label className="fieldcell">
              <span className="label">Their competence</span>
              <input className="field field--sm" id="r-competence" value={competence} placeholder="Licensed heavy vehicle mechanic; manufacturer's service agent" onChange={(e) => setCompetence(e.target.value)} />
            </label>
            <label className="fieldcell">
              <span className="label">Company</span>
              <input className="field field--sm" id="r-org" value={organisation} placeholder="Optional" onChange={(e) => setOrganisation(e.target.value)} />
            </label>
          </div>
          <div className="signin__grid">
            <label className="fieldcell fieldcell--narrow">
              <span className="label">Hour meter</span>
              <input className="field field--sm" id="r-hours" inputMode="decimal" value={hours} placeholder="—" onChange={(e) => setHours(e.target.value)} />
            </label>
            <label className="fieldcell">
              <span className="label">Outcome</span>
              <select className="field field--sm" id="r-outcome" value={outcome} onChange={(e) => setOutcome(e.target.value as Outcome | '')}>
                <option value="">Not stated</option>
                {OUTCOMES.map((o) => <option key={o} value={o}>{OUTCOME_LABEL[o]}</option>)}
              </select>
            </label>
            <label className="fieldcell">
              <span className="label">Next due, if they set it</span>
              <input className="field field--sm" id="r-next" type="date" value={nextDue} onChange={(e) => setNextDue(e.target.value)} />
            </label>
          </div>
          <label className="fieldcell">
            <span className="label">Findings</span>
            <textarea className="field field--sm" id="r-findings" rows={2} value={findings} onChange={(e) => setFindings(e.target.value)} />
          </label>
          <label className="button button--quiet" style={{ marginTop: '0.5rem' }}>
            {file ? `Chosen: ${file.name}` : 'Attach the report or certificate (optional)'}
            <input type="file" accept="application/pdf,image/*" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
          <button type="button" className="button" disabled={busy !== null || !by.trim()} onClick={() => void addRecord()}>{busy === 'record' ? 'Recording…' : 'Record it'}</button>
          <button type="button" className="linklike" onClick={() => setAdding(false)}>Cancel</button>
          <p className="caption">Once recorded it cannot be changed.</p>
        </div>
      ))}
    </>
  );
}
