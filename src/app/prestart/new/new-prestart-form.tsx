'use client';

import { useEffect, useState } from 'react';
import { fmtDate } from '@/lib/pdf/dates';
import { PrestartSpecPicker } from '../spec-picker';
import type { SpecNote } from '@/lib/prestart/spec-notes';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { localDate } from '@/lib/capture/queue';
import { BrandMark } from '@/components/brand-mark';
import { PRESTART_CHECKS, type ChecklistState } from '@/lib/prestart/checklist';
import { DictateButton } from '../dictate-button';
import { mergeField, appendDictation, type DictatedFields } from '@/lib/prestart/dictation-merge';
import * as outbox from '@/lib/outbox/store';
import { runOrQueue } from '@/lib/outbox/sync';
import { PrestartScreen } from '../[id]/prestart-screen';
import { readChecklist } from '@/lib/prestart/checklist';

/**
 * What is on, what could hurt someone, the checks — then hand the phone
 * around. Nothing is pre-ticked: a check that prints as done was ticked by
 * the supervisor on the day.
 */
/**
 * A prestart made with no signal lives in the outbox until it sends. This
 * renders it from there — the same screen the crew would see from the
 * server — so they can sign on and the supervisor can finish it, all kept on
 * the phone, all sent together when the signal comes back.
 */
function LocalPrestart({ localId, projectId, projectName, crew }: { localId: string; projectId: string; projectName: string; crew: string[] }) {
  const router = useRouter();
  const [row, setRow] = useState<Record<string, unknown> | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const items = await outbox.forSubject(localId);
      const create = items.find((i) => i.kind === 'prestart_create');
      if (cancelled) return;
      if (!create) {
        // Sent: the real page has it now.
        if (items.length === 0) router.replace(`/prestart/${localId}`);
        else setRow(null);
        return;
      }
      setRow(create.payload.row as Record<string, unknown>);
    };
    void load();
    const stop = outbox.onOutboxChange(() => void load());
    return () => { cancelled = true; stop(); };
  }, [localId, router]);
  if (row === undefined) return <main className="sheet"><p className="caption">Opening…</p></main>;
  if (row === null) return <main className="sheet"><p className="notice gap">That prestart has been sent. <Link className="linklike" href={`/prestart/${localId}`}>Open it</Link>.</p></main>;
  return (
    <PrestartScreen
      local
      prestart={{
        id: localId, projectId, date: String(row.prestart_date), supervisor: String(row.supervisor_name),
        work: String(row.work_planned), hazards: String(row.hazards), plant: String(row.plant ?? ''), permits: String(row.permits ?? ''),
        notes: String(row.notes ?? ''), dictation: (row.dictation as string | null) ?? null,
        checklist: readChecklist(row.checklist), specNotes: (row.spec_notes as SpecNote[]) ?? [], completed: false,
      }}
      attendees={[]}
      crew={crew}
      canRun
      projectName={projectName}
    />
  );
}

export function NewPrestartForm({
  projectId,
  projectName,
  defaultSupervisor,
  crew = [],
  localId = null,
}: {
  projectId: string;
  projectName: string;
  defaultSupervisor: string;
  crew?: string[];
  localId?: string | null;
}) {
  const router = useRouter();
  const [keptLocally, setKeptLocally] = useState<string | null>(localId);
  const [date, setDate] = useState(localDate());
  const [supervisor, setSupervisor] = useState(defaultSupervisor);
  const [work, setWork] = useState('');
  const [hazards, setHazards] = useState('');
  const [plant, setPlant] = useState('');
  const [permits, setPermits] = useState('');
  const [notes, setNotes] = useState('');
  const [checks, setChecks] = useState<ChecklistState>({});
  const [specNotes, setSpecNotes] = useState<SpecNote[]>([]);
  const [dictation, setDictation] = useState<string | null>(null);
  // What the plant tick is standing on: machines with a signed plant prestart today.
  const [plantDone, setPlantDone] = useState<string[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('plant_prestarts')
        .select('plant:plant_register!inner(name)')
        .eq('project_id', projectId)
        .eq('prestart_date', date)
        .not('completed_at', 'is', null);
      if (cancelled) return;
      const names = (data ?? []).map((r) => { const p = Array.isArray(r.plant) ? r.plant[0] : r.plant; return (p as { name?: string } | null)?.name ?? ''; }).filter(Boolean);
      setPlantDone([...new Set(names)]);
    })();
    return () => { cancelled = true; };
  }, [projectId, date]);
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
      const { data: session } = await supabase.auth.getSession();
      const userId = session.session?.user.id;
      if (!userId) throw new Error('You are signed out.');
      const id = outbox.newId();
      const row = {
        id,
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
        dictation,
        conducted_by: userId,
        created_at: new Date().toISOString(),
      };
      const live = async () => {
        const { error: insertError } = await supabase.from('prestarts').insert(row);
        if (insertError) throw new Error(insertError.message);
      };
      const queue = () => outbox.enqueue({ kind: 'prestart_create', projectId, subjectId: id, payload: { row } }).then(() => undefined);
      const outcome = await runOrQueue(live, queue);
      if (outcome === 'queued') {
        // No signal: run it from the phone. The URL carries the id so the
        // cached page can reopen it later.
        if (mode === 'morning') { router.push(`/prestart?project=${projectId}&kept=${forDate}`); return; }
        window.history.replaceState(null, '', `/prestart/new?project=${projectId}&local=${id}`);
        setKeptLocally(id);
        setBusy(false);
        return;
      }
      if (mode === 'morning') router.push(`/prestart?project=${projectId}&ready=${forDate}`);
      else router.push(`/prestart/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The prestart was not created.');
      setBusy(false);
    }
  }

  if (keptLocally) return <LocalPrestart localId={keptLocally} projectId={projectId} projectName={projectName} crew={crew} />;

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

      <DictateButton projectId={projectId} disabled={busy} onResult={(fields: DictatedFields, transcript) => {
        setWork((v) => mergeField(v, fields.work_planned));
        setHazards((v) => mergeField(v, fields.hazards));
        setPlant((v) => mergeField(v, fields.plant));
        setPermits((v) => mergeField(v, fields.permits));
        setNotes((v) => mergeField(v, fields.notes));
        setDictation((v) => appendDictation(v, transcript));
      }} />

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

      {plantDone !== null && (
        <p className={`notice${plantDone.length ? '' : ' gap'}`} style={{ marginTop: '1rem' }}>
          {plantDone.length
            ? `Plant prestarted today: ${plantDone.join(', ')}.`
            : 'No plant prestart signed yet today.'}{' '}
          <Link className="linklike" href={`/plant?project=${projectId}`}>Plant</Link>
        </p>
      )}
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
