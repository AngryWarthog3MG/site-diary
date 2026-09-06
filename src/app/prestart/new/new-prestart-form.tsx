'use client';

import { useState } from 'react';
import { fmtDate } from '@/lib/pdf/dates';
import { PrestartSpecPicker } from '../spec-picker';
import type { SpecNote } from '@/lib/prestart/spec-notes';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { localDate } from '@/lib/capture/queue';
import { BrandMark } from '@/components/brand-mark';
import { PRESTART_CHECKS, type ChecklistState } from '@/lib/prestart/checklist';

/**
 * What is on, what could hurt someone, the checks — then hand the phone
 * around. Nothing is pre-ticked: a check that prints as done was ticked by
 * the supervisor on the day.
 */
export function NewPrestartForm({
  projectId,
  projectName,
  defaultSupervisor,
}: {
  projectId: string;
  projectName: string;
  defaultSupervisor: string;
}) {
  const router = useRouter();
  const [date, setDate] = useState(localDate());
  const [supervisor, setSupervisor] = useState(defaultSupervisor);
  const [work, setWork] = useState('');
  const [hazards, setHazards] = useState('');
  const [plant, setPlant] = useState('');
  const [permits, setPermits] = useState('');
  const [notes, setNotes] = useState('');
  const [checks, setChecks] = useState<ChecklistState>({});
  const [specNotes, setSpecNotes] = useState<SpecNote[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = supervisor.trim() && work.trim() && hazards.trim();

  /** Tomorrow's date on this device — the morning the prestart is for. */
  function tomorrow(): string {
    const d = new Date(`${localDate()}T12:00:00`);
    d.setDate(d.getDate() + 1);
    return localDate(d);
  }
  const preparing = date > localDate();

  async function create(mode: 'now' | 'morning' = 'now') {
    const forDate = mode === 'morning' && date <= localDate() ? tomorrow() : date;
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data: auth } = await supabase.auth.getUser();
      const { data, error: insertError } = await supabase
        .from('prestarts')
        .insert({
          project_id: projectId,
          prestart_date: forDate,
          supervisor_name: supervisor.trim(),
          work_planned: work.trim(),
          hazards: hazards.trim(),
          plant: plant.trim() || null,
          permits: permits.trim() || null,
          notes: notes.trim() || null,
          checklist: checks,
          spec_notes: specNotes,
          conducted_by: auth.user?.id,
        })
        .select('id')
        .single();
      if (insertError) throw new Error(insertError.message);
      if (mode === 'morning') router.push(`/prestart?project=${projectId}&ready=${forDate}`);
      else router.push(`/prestart/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The prestart was not created.');
      setBusy(false);
    }
  }

  return (
    <main className="sheet">
      <p className="label">
        <BrandMark size={18} /> {projectName}
      </p>
      <h1 className="page-title">{preparing ? `Prestart for ${fmtDate(date)}` : 'Today\u2019s prestart'}</h1>
      <p className="page-subtitle">
        Fill this in, read it out to the crew, then hand the phone around for sign-on.
      </p>
      <hr className="rule" />

      <div className="photo-add-pair">
        <label className="fieldcell" style={{ flex: 1 }}>
          <span className="label">Date</span>
          <input className="field field--sm" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="fieldcell" style={{ flex: 1 }}>
          <span className="label">Run by</span>
          <input className="field field--sm" value={supervisor} placeholder="Mitch"
            onChange={(e) => setSupervisor(e.target.value)} />
        </label>
      </div>

      <label className="fieldcell">
        <span className="label">What is on today</span>
        <textarea className="field" rows={4} value={work}
          placeholder="Busport: topsoil and planting. Old Brand Drive: vac truck potholing near the comms pit."
          onChange={(e) => setWork(e.target.value)} />
      </label>

      <PrestartSpecPicker projectId={projectId} work={work} notes={specNotes} readOnly={false} onKeep={setSpecNotes} />

      <label className="fieldcell">
        <span className="label">Hazards and controls</span>
        <textarea className="field" rows={5} value={hazards}
          placeholder={'- Live comms pit near gate 2: hand dig only, spotter on the vac\n- Public footpath next to Busport: barricade and signage before starting'}
          onChange={(e) => setHazards(e.target.value)} />
      </label>

      <label className="fieldcell">
        <span className="label">Plant on site</span>
        <textarea className="field" rows={2} value={plant}
          placeholder="1.8t excavator, vac truck (wet hire)" onChange={(e) => setPlant(e.target.value)} />
      </label>

      <label className="fieldcell">
        <span className="label">Permits</span>
        <input className="field" value={permits} placeholder="Excavation permit #, hot work — or none today"
          onChange={(e) => setPermits(e.target.value)} />
      </label>

      <p className="label" style={{ marginTop: '1rem' }}>Checks — tick what has been done</p>
      <div className="checklist">
        {PRESTART_CHECKS.map((item) => (
          <label key={item.key} className={`checkrow${checks[item.key] ? ' checkrow--on' : ''}`}>
            <input type="checkbox" checked={Boolean(checks[item.key])}
              onChange={(e) => setChecks({ ...checks, [item.key]: e.target.checked })} />
            <span>{item.label}</span>
          </label>
        ))}
      </div>

      <label className="fieldcell">
        <span className="label">Anything else</span>
        <textarea className="field" rows={2} value={notes}
          placeholder="Deliveries expected, visitors, weather watch…" onChange={(e) => setNotes(e.target.value)} />
      </label>

      {error && <p className="alert">{error}</p>}
      {!ready && (
        <p className="notice gap">
          Still needed before it can be saved:{' '}
          {[!supervisor.trim() && 'who is running it', !work.trim() && 'what is on today', !hazards.trim() && 'hazards and controls'].filter(Boolean).join(', ')}.
        </p>
      )}
      <button className="button" type="button" disabled={busy || !ready} onClick={() => create('now')}>
        {busy ? 'Starting…' : preparing ? `Open it for ${fmtDate(date)}` : 'Start sign-on'}
      </button>
      <button className="button button--outline" type="button" disabled={busy || !ready} onClick={() => create('morning')}>
        {busy ? 'Saving…' : preparing ? `Save for ${fmtDate(date)}` : 'Save for the morning'}
      </button>
      <p className="way-hint">
        Start sign-on opens it now for the crew. Save for the morning keeps it ready for
        {preparing ? ` ${fmtDate(date)}` : ' tomorrow'}: it waits on Today, the 06:30 reminder points at it, and you can
        still change anything until the crew have signed and you finish it.
      </p>
      <Link className="button button--quiet" href={`/prestart?project=${projectId}`}>All prestarts</Link>
    </main>
  );
}
