'use client';

import { useState } from 'react';
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = supervisor.trim() && work.trim() && hazards.trim();

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data: auth } = await supabase.auth.getUser();
      const { data, error: insertError } = await supabase
        .from('prestarts')
        .insert({
          project_id: projectId,
          prestart_date: date,
          supervisor_name: supervisor.trim(),
          work_planned: work.trim(),
          hazards: hazards.trim(),
          plant: plant.trim() || null,
          permits: permits.trim() || null,
          notes: notes.trim() || null,
          checklist: checks,
          conducted_by: auth.user?.id,
        })
        .select('id')
        .single();
      if (insertError) throw new Error(insertError.message);
      router.push(`/prestart/${data.id}`);
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
      <h1 className="page-title">Today&rsquo;s prestart</h1>
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
      <button className="button" type="button" disabled={busy || !ready} onClick={create}>
        {busy ? 'Starting…' : 'Start sign-on'}
      </button>
      <p className="way-hint">You can still change any of this until the crew have signed and you finish it.</p>
      <Link className="button button--quiet" href={`/prestart?project=${projectId}`}>All prestarts</Link>
    </main>
  );
}
