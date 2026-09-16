'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

function useSave() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not save.');
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, setError, run };
}

/** Start an ITP. It opens as a draft on its own page, where the points are added. */
export function NewItpForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const { busy, error, run } = useSave();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [title, setTitle] = useState('');
  const [spec, setSpec] = useState('');
  if (!open) return <button type="button" className="button button--quiet" style={{ marginTop: '0.75rem' }} onClick={() => setOpen(true)}>New inspection and test plan</button>;
  return (
    <div className="item" style={{ marginTop: '0.75rem' }}>
      {error && <p className="alert" role="alert">{error}</p>}
      <div className="signin__grid">
        <label className="fieldcell fieldcell--narrow">
          <span className="label">Code</span>
          <input className="field field--sm" id="itp-code" value={code} placeholder="ITP-01" onChange={(e) => setCode(e.target.value)} />
        </label>
        <label className="fieldcell">
          <span className="label">Work process</span>
          <input className="field field--sm" id="itp-title" value={title} placeholder="Subgrade and basecourse" onChange={(e) => setTitle(e.target.value)} />
        </label>
      </div>
      <label className="fieldcell">
        <span className="label">Specification</span>
        <input className="field field--sm" id="itp-spec" value={spec} placeholder="MRWA Spec 501; drawing C-101 rev C" onChange={(e) => setSpec(e.target.value)} />
      </label>
      <button type="button" className="button" disabled={busy || !code.trim() || !title.trim()} onClick={() => void run(async () => {
        const { data, error: e } = await createClient().from('itps').insert({ project_id: projectId, code: code.trim(), title: title.trim(), spec_reference: spec.trim() || null, revision: 0 }).select('id').single();
        if (e) throw new Error(e.message);
        router.push(`/quality/itp/${data.id}?project=${projectId}`);
      })}>{busy ? 'Starting…' : 'Start the draft'}</button>
      <button type="button" className="linklike" onClick={() => setOpen(false)}>Cancel</button>
    </div>
  );
}

/** Open a lot against an issued ITP. The database numbers it. */
export function OpenLotForm({ projectId, itps }: { projectId: string; itps: Array<{ id: string; label: string }> }) {
  const router = useRouter();
  const { busy, error, run } = useSave();
  const [open, setOpen] = useState(false);
  const [itpId, setItpId] = useState(itps[0]?.id ?? '');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [surveyed, setSurveyed] = useState('');
  if (!open) return <button type="button" className="button button--quiet" style={{ marginTop: '0.75rem' }} onClick={() => setOpen(true)}>Open a lot</button>;
  return (
    <div className="item" style={{ marginTop: '0.75rem' }}>
      {error && <p className="alert" role="alert">{error}</p>}
      <label className="fieldcell">
        <span className="label">Worked to</span>
        <select className="field field--sm" id="lot-itp" value={itpId} onChange={(e) => setItpId(e.target.value)}>
          {itps.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
        </select>
      </label>
      <label className="fieldcell">
        <span className="label">What the lot is</span>
        <input className="field field--sm" id="lot-desc" value={description} placeholder="Car park subgrade, bay A" onChange={(e) => setDescription(e.target.value)} />
      </label>
      <div className="signin__grid">
        <label className="fieldcell">
          <span className="label">Where</span>
          <input className="field field--sm" id="lot-loc" value={location} placeholder="CH 0–50, left side" onChange={(e) => setLocation(e.target.value)} />
        </label>
        <label className="fieldcell">
          <span className="label">Surveyed position, where needed</span>
          <input className="field field--sm" id="lot-survey" value={surveyed} placeholder="E, N, RL — optional" onChange={(e) => setSurveyed(e.target.value)} />
        </label>
      </div>
      <button type="button" className="button" disabled={busy || !itpId || !description.trim() || !location.trim()} onClick={() => void run(async () => {
        const { data, error: e } = await createClient().from('lots').insert({ project_id: projectId, itp_id: itpId, description: description.trim(), location: location.trim(), surveyed_position: surveyed.trim() || null, seq: 0 }).select('id').single();
        if (e) throw new Error(e.message);
        router.push(`/quality/lot/${data.id}?project=${projectId}`);
      })}>{busy ? 'Opening…' : 'Open the lot'}</button>
      <button type="button" className="linklike" onClick={() => setOpen(false)}>Cancel</button>
    </div>
  );
}

/** Raise a non-conformance. The observation is the first account and never changes. */
export function RaiseNcrForm({ projectId, lotId, points }: { projectId: string; lotId?: string; points?: Array<{ id: string; label: string }> }) {
  const router = useRouter();
  const { busy, error, run } = useSave();
  const [open, setOpen] = useState(false);
  const [observation, setObservation] = useState('');
  const [by, setBy] = useState('');
  const [pointId, setPointId] = useState('');
  const [location, setLocation] = useState('');
  if (!open) return <button type="button" className="button button--quiet" style={{ marginTop: '0.75rem' }} onClick={() => setOpen(true)}>Raise a non-conformance</button>;
  return (
    <div className="item" style={{ marginTop: '0.75rem' }}>
      {error && <p className="alert" role="alert">{error}</p>}
      <label className="fieldcell">
        <span className="label">What was found</span>
        <textarea className="field field--sm" id="ncr-obs" rows={3} value={observation} placeholder="Compaction 94% MDD against 98% required, test LAB-2292" onChange={(e) => setObservation(e.target.value)} />
      </label>
      <div className="signin__grid">
        <label className="fieldcell">
          <span className="label">Found by</span>
          <input className="field field--sm" id="ncr-by" value={by} onChange={(e) => setBy(e.target.value)} />
        </label>
        {!lotId && (
          <label className="fieldcell">
            <span className="label">Where</span>
            <input className="field field--sm" id="ncr-loc" value={location} onChange={(e) => setLocation(e.target.value)} />
          </label>
        )}
      </div>
      {points && points.length > 0 && (
        <label className="fieldcell">
          <span className="label">Against point</span>
          <select className="field field--sm" id="ncr-point" value={pointId} onChange={(e) => setPointId(e.target.value)}>
            <option value="">The lot as a whole</option>
            {points.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>
      )}
      <button type="button" className="button" disabled={busy || !observation.trim() || !by.trim()} onClick={() => void run(async () => {
        const { data, error: e } = await createClient().from('ncrs').insert({
          project_id: projectId, lot_id: lotId ?? null, itp_point_id: pointId || null, seq: 0,
          detected_at: new Date().toISOString(), detected_by_name: by.trim(), observation: observation.trim(), location: location.trim() || null,
        }).select('id').single();
        if (e) throw new Error(e.message);
        router.push(`/quality/ncr/${data.id}?project=${projectId}`);
      })}>{busy ? 'Raising…' : 'Raise it'}</button>
      <button type="button" className="linklike" onClick={() => setOpen(false)}>Cancel</button>
      <p className="caption">{lotId ? 'The lot goes on hold until this is dealt with.' : 'What was found cannot be changed afterwards.'}</p>
    </div>
  );
}

/** The contract's reporting deadline for this job. Admin only. */
export function NcrClockSetting({ projectId, hours }: { projectId: string; hours: number | null }) {
  const router = useRouter();
  const { busy, error, setError, run } = useSave();
  const [value, setValue] = useState(hours == null ? '' : String(hours));
  return (
    <div className="signin__grid" style={{ marginTop: '0.5rem', alignItems: 'end' }}>
      <label className="fieldcell fieldcell--narrow">
        <span className="label">Hours</span>
        <input className="field field--sm" id="ncr-clock" inputMode="numeric" value={value} placeholder="None" onChange={(e) => setValue(e.target.value)} />
      </label>
      <button type="button" className="button button--quiet" disabled={busy} onClick={() => void run(async () => {
        const n = value.trim() === '' ? null : Number(value);
        if (n != null && (!Number.isInteger(n) || n < 1 || n > 720)) { setError('Whole hours, 1 to 720, or blank for none.'); return; }
        const { error: e } = await createClient().from('projects').update({ ncr_report_hours: n }).eq('id', projectId);
        if (e) throw new Error(e.message);
        router.refresh();
      })}>{busy ? 'Saving…' : 'Save'}</button>
      {error && <p className="alert" role="alert">{error}</p>}
    </div>
  );
}
