'use client';

import { useEffect, useRef, useState } from 'react';
import { Recorder, isSupported } from '@/lib/capture/recorder';
import type { DictatedFields } from '@/lib/prestart/dictation-merge';

/**
 * Talk the prestart through. One tap starts the microphone, the next stops it
 * and sends the recording up; what comes back lands in the form's fields for
 * the supervisor to read, fix and save. Nothing is stored by this button.
 */
export function DictateButton({
  projectId,
  onResult,
  disabled,
  field,
}: {
  projectId: string;
  onResult: (fields: DictatedFields, transcript: string) => void;
  disabled?: boolean;
  /** Talk one field in on its own — the hazards box has its own mic (README R58). */
  field?: 'hazards';
}) {
  const recorderRef = useRef<Recorder | null>(null);
  const [state, setState] = useState<'idle' | 'recording' | 'working'>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState(true);
  const [lastHeard, setLastHeard] = useState<string | null>(null);

  useEffect(() => setSupported(isSupported()), []);
  useEffect(() => {
    if (state !== 'recording') return;
    const tick = setInterval(() => setElapsed(recorderRef.current?.elapsedMs() ?? 0), 500);
    return () => clearInterval(tick);
  }, [state]);
  useEffect(() => () => recorderRef.current?.dispose(), []);

  async function start() {
    setError(null);
    setLastHeard(null);
    try {
      const recorder = await Recorder.create();
      recorderRef.current = recorder;
      await recorder.start();
      setElapsed(0);
      setState('recording');
    } catch (err) {
      setError(err instanceof Error && /denied|permission/i.test(err.message)
        ? 'The microphone is blocked for this app. Allow it in your phone’s settings, or type the prestart in.'
        : 'The microphone did not start. Type the prestart in instead.');
      recorderRef.current = null;
    }
  }

  async function stop() {
    const recorder = recorderRef.current;
    if (!recorder) return;
    setState('working');
    try {
      const recording = await recorder.stop();
      recorderRef.current = null;
      const form = new FormData();
      form.set('projectId', projectId);
      form.set('audio', recording.blob, `prestart.${recording.mimeType.includes('mp4') ? 'm4a' : 'webm'}`);
      if (field) form.set('field', field);
      const res = await fetch('/api/prestart/dictate', { method: 'POST', body: form });
      const json = (await res.json().catch(() => null)) as
        | { transcript?: string; fields?: DictatedFields; error?: { message?: string }; message?: string }
        | null;
      if (!res.ok || !json?.fields) {
        throw new Error(json?.error?.message ?? json?.message ?? 'That recording could not be written up.');
      }
      setLastHeard(json.transcript ?? null);
      onResult(json.fields, json.transcript ?? '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That recording could not be written up.');
    } finally {
      setState('idle');
    }
  }

  if (!supported) return null;

  const clock = `${Math.floor(elapsed / 60000)}:${String(Math.floor((elapsed % 60000) / 1000)).padStart(2, '0')}`;

  const words = field === 'hazards'
    ? { idle: 'Talk the hazards in', working: 'Writing them up…', stop: 'Stop and write them up', recording: 'Say each hazard and how you are controlling it, one after the other.', hint: 'Only this box fills. Read it back before you save.' }
    : { idle: 'Talk it through', working: 'Writing it up…', stop: 'Stop and write it up', recording: 'Say what is on, what could hurt someone and how you are controlling it, what plant is here, any permits.', hint: 'Say the briefing out loud. It fills the fields below for you to check — nothing is ticked for you.' };

  return (
    <div className={`dictate${field ? ' dictate--field' : ''}`}>
      {state === 'recording' ? (
        <button className="button button--record dictate__button" type="button" onClick={stop}>
          <span className="dictate__dot" aria-hidden /> {words.stop} · {clock}
        </button>
      ) : (
        <button className="button button--record dictate__button" type="button" onClick={start}
          disabled={disabled || state === 'working'}>
          {state === 'working' ? words.working : words.idle}
        </button>
      )}
      <p className="way-hint">{state === 'recording' ? words.recording : words.hint}</p>
      {error && <p className="alert">{error}</p>}
      {lastHeard && (
        <details className="dictate__heard">
          <summary>What was heard</summary>
          <blockquote className="quote">{lastHeard}</blockquote>
        </details>
      )}
    </div>
  );
}
