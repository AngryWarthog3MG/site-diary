'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { TRENCH_CONTROLS, TRENCH_CONTROL_LABEL, trenchNeedsControl, trenchProblem, type TrenchControl } from '@/lib/construction/model';

/**
 * Record an excavation before the dig: where the services information came
 * from and what it showed, who located the services, and — at 1.5 m or deeper —
 * how the trench is held up. The plans file is uploaded first and the row
 * recorded second; if the row fails the file is removed, so nothing is left
 * in storage the record does not point at.
 */
export function ExcavationForm({ projectId, today }: { projectId: string; today: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [location, setLocation] = useState('');
  const [startOn, setStartOn] = useState('');
  const [source, setSource] = useState('Before You Dig Australia');
  const [reference, setReference] = useState('');
  const [obtainedOn, setObtainedOn] = useState(today);
  const [validUntil, setValidUntil] = useState('');
  const [services, setServices] = useState('');
  const [locatedBy, setLocatedBy] = useState('');
  const [method, setMethod] = useState('');
  const [locatedOn, setLocatedOn] = useState('');
  const [depth, setDepth] = useState('');
  const [control, setControl] = useState<TrenchControl | ''>('');
  const [engineerRef, setEngineerRef] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const depthNum = depth.trim() === '' ? null : Number(depth);
  const problem = depthNum != null && Number.isFinite(depthNum) ? trenchProblem(depthNum, control || null, engineerRef) : null;

  async function save() {
    if (!location.trim()) { setError('Say where the excavation is.'); return; }
    if (!reference.trim()) { setError('Give the reference for the services information — the Before You Dig job number, or where the plans came from.'); return; }
    if (depthNum != null && (!Number.isFinite(depthNum) || depthNum < 0)) { setError('The depth is in metres, or leave it blank.'); return; }
    if (problem) { setError(problem); return; }
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const id = crypto.randomUUID();
    let path: string | null = null;
    try {
      if (file) {
        const ext = (file.name.split('.').pop() ?? 'pdf').toLowerCase().replace(/[^a-z0-9]/g, '') || 'pdf';
        path = `${projectId}/${id}.${ext}`;
        const { error: upErr } = await supabase.storage.from('services-plans').upload(path, file, { contentType: file.type || 'application/pdf', upsert: false });
        if (upErr) throw new Error(`The plans did not upload: ${upErr.message}`);
      }
      const { error: e } = await supabase.from('excavation_records').insert({
        id, project_id: projectId, location: location.trim(), planned_start_on: startOn || null,
        info_source: source.trim() || 'Before You Dig Australia', info_reference: reference.trim(),
        info_obtained_on: obtainedOn, info_valid_until: validUntil || null,
        services_identified: services.trim() || null, plans_file_path: path,
        services_located_by: locatedBy.trim() || null, locating_method: method.trim() || null, located_on: locatedOn || null,
        max_depth_m: depthNum, trench_control: control || null, engineer_advice_ref: engineerRef.trim() || null,
      });
      if (e) {
        if (path) await supabase.storage.from('services-plans').remove([path]).catch(() => undefined);
        throw new Error(e.message);
      }
      setOpen(false);
      setLocation(''); setStartOn(''); setReference(''); setValidUntil(''); setServices(''); setLocatedBy(''); setMethod(''); setLocatedOn('');
      setDepth(''); setControl(''); setEngineerRef(''); setFile(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not save.');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return <button type="button" className="button button--quiet" style={{ marginTop: '0.75rem' }} onClick={() => setOpen(true)}>Record an excavation</button>;
  }

  return (
    <div className="item" style={{ marginTop: '0.75rem' }}>
      <p className="label">An excavation</p>
      {error && <p className="alert" role="alert">{error}</p>}
      <div className="signin__grid">
        <label className="fieldcell">
          <span className="label">Where</span>
          <input className="field field--sm" id="ex-location" value={location} placeholder="Car park stormwater, CH 120–180" onChange={(e) => setLocation(e.target.value)} />
        </label>
        <label className="fieldcell">
          <span className="label">Digging from</span>
          <input className="field field--sm" id="ex-start" type="date" value={startOn} onChange={(e) => setStartOn(e.target.value)} />
        </label>
      </div>
      <p className="label" style={{ marginTop: '0.6rem' }}>Underground services information</p>
      <div className="signin__grid">
        <label className="fieldcell">
          <span className="label">From</span>
          <input className="field field--sm" id="ex-source" value={source} onChange={(e) => setSource(e.target.value)} />
        </label>
        <label className="fieldcell">
          <span className="label">Reference</span>
          <input className="field field--sm" id="ex-ref" value={reference} placeholder="Job number" onChange={(e) => setReference(e.target.value)} />
        </label>
      </div>
      <div className="signin__grid">
        <label className="fieldcell">
          <span className="label">Obtained on</span>
          <input className="field field--sm" id="ex-obtained" type="date" value={obtainedOn} max={today} onChange={(e) => setObtainedOn(e.target.value)} />
        </label>
        <label className="fieldcell">
          <span className="label">Valid until, as stated</span>
          <input className="field field--sm" id="ex-valid" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
        </label>
      </div>
      <label className="fieldcell">
        <span className="label">Services shown</span>
        <textarea className="field field--sm" id="ex-services" rows={2} value={services} placeholder="Telstra comms along the kerb; Water Corp 150 mm main across the entry" onChange={(e) => setServices(e.target.value)} />
      </label>
      <label className="button button--quiet" style={{ marginTop: '0.5rem' }}>
        {file ? `Chosen: ${file.name}` : 'Attach the plans (optional)'}
        <input type="file" accept="application/pdf,image/*" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </label>
      <div className="signin__grid">
        <label className="fieldcell">
          <span className="label">Located by</span>
          <input className="field field--sm" id="ex-locby" value={locatedBy} placeholder="Name, company" onChange={(e) => setLocatedBy(e.target.value)} />
        </label>
        <label className="fieldcell">
          <span className="label">How</span>
          <input className="field field--sm" id="ex-method" value={method} placeholder="Electronic locator, potholed by vac truck" onChange={(e) => setMethod(e.target.value)} />
        </label>
        <label className="fieldcell">
          <span className="label">On</span>
          <input className="field field--sm" id="ex-locon" type="date" value={locatedOn} max={today} onChange={(e) => setLocatedOn(e.target.value)} />
        </label>
      </div>
      <p className="label" style={{ marginTop: '0.6rem' }}>Trench</p>
      <div className="signin__grid">
        <label className="fieldcell fieldcell--narrow">
          <span className="label">Deepest (m)</span>
          <input className="field field--sm" id="ex-depth" inputMode="decimal" value={depth} placeholder="—" onChange={(e) => setDepth(e.target.value)} />
        </label>
        <label className="fieldcell">
          <span className="label">Held up by{depthNum != null && trenchNeedsControl(depthNum) ? ' — required' : ''}</span>
          <select className="field field--sm" id="ex-control" value={control} onChange={(e) => setControl(e.target.value as TrenchControl | '')}>
            <option value="">{depthNum != null && trenchNeedsControl(depthNum) ? 'Choose…' : 'Not needed under 1.5 m'}</option>
            {TRENCH_CONTROLS.map((c) => <option key={c} value={c}>{TRENCH_CONTROL_LABEL[c]}</option>)}
          </select>
        </label>
      </div>
      {control === 'engineer_advice' && (
        <label className="fieldcell">
          <span className="label">The engineer&rsquo;s written advice</span>
          <input className="field field--sm" id="ex-engineer" value={engineerRef} placeholder="Company, report number, date" onChange={(e) => setEngineerRef(e.target.value)} />
        </label>
      )}
      {problem && <p className="caption vr-missing">{problem}</p>}
      <button type="button" className="button" disabled={busy || !location.trim() || !reference.trim() || Boolean(problem)} onClick={() => void save()}>
        {busy ? 'Saving…' : 'Record the excavation'}
      </button>
      <button type="button" className="linklike" onClick={() => setOpen(false)}>Cancel</button>
      <p className="caption">Once recorded it cannot be changed.</p>
    </div>
  );
}
