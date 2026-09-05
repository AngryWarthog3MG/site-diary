'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { BrandMark } from '@/components/brand-mark';
import { useRouter } from 'next/navigation';
import type { EntrySection } from '@/types/database';
import { Recorder, isSupported } from '@/lib/capture/recorder';
import { LiveTranscriber } from '@/lib/capture/live';
import { detectSections } from '@/lib/capture/sections';
import * as queue from '@/lib/capture/queue';
import * as sync from '@/lib/capture/sync';
import { createClient } from '@/lib/supabase/client';
import { SectionChips } from '@/components/section-chips';
import { Waveform } from '@/components/waveform';
import { QueueStatus } from '@/components/queue-status';

type Phase = 'idle' | 'starting' | 'recording' | 'paused' | 'saving' | 'saved' | 'error';
type CaptureMode = 'voice' | 'text';

/**
 * The live transcript is decoration that costs real money: it streams the
 * same audio to Deepgram a second time, at streaming rates, while the batch
 * pass over the finished file is what actually becomes the record. Roughly
 * doubling transcription spend for chips that light up early was the owner's
 * call to drop (2026-08-27). Set NEXT_PUBLIC_LIVE_TRANSCRIPT=1 to bring it
 * back — everything downstream is unchanged either way.
 */
const LIVE_TRANSCRIPT = process.env.NEXT_PUBLIC_LIVE_TRANSCRIPT === '1';

function clock(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Screen 2 (brief §7.2): timer, live waveform, streaming transcript, and the
 * section chips lighting up as each subject gets covered.
 *
 * The order of operations at the end matters more than anything on screen: the
 * blob goes into IndexedDB before a single network call is attempted. Sync is
 * something that happens to a recording that is already safe.
 */
export function RecordScreen({
  projectId,
  projectName,
  orgCode,
  forDate,
}: {
  projectId: string;
  projectName: string;
  orgCode: string;
  forDate?: string | null;
}) {
  const router = useRouter();
  const recorderRef = useRef<Recorder | null>(null);
  const liveRef = useRef<LiveTranscriber | null>(null);
  const termsRef = useRef<{ labour: string[]; plant: string[] }>({ labour: [], plant: [] });

  // Assume the browser can record, and correct after mount. Checked during
  // render instead, `isSupported()` is always false on the server — navigator
  // and MediaRecorder do not exist there — so every supervisor got a flash of
  // "this browser cannot record audio" before hydration replaced it, and React
  // logged a hydration mismatch every time.
  const [supported, setSupported] = useState(true);
  const [phase, setPhase] = useState<Phase>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [finalText, setFinalText] = useState('');
  const [interim, setInterim] = useState('');
  const [typedText, setTypedText] = useState('');
  const [fillingIn, setFillingIn] = useState(false);

  /**
   * The other way in: not a box to type prose into for the model to read,
   * but the entry itself — labour off the crew list, plant off the plant
   * list, every field a field. Opens the day's draft and goes there.
   */
  async function fillItIn() {
    setFillingIn(true);
    try {
      const response = await fetch('/api/entries', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId, entryDate: targetDate }),
      });
      const json = await response.json().catch(() => null);
      if (response.ok && json?.entryId) {
        router.push(`/entries/${json.entryId}/review`);
        return;
      }
      if (json?.entryId) {
        router.push(`/entries/${json.entryId}/signed`);
        return;
      }
    } catch {
      // No signal: talking still works offline; filling in needs the server.
    }
    setFillingIn(false);
  }
  const [covered, setCovered] = useState<Set<EntrySection>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [liveOn, setLiveOn] = useState(false);
  const [mode, setMode] = useState<CaptureMode>('voice');

  const active = phase === 'recording';
  const textReady = typedText.trim().length > 0;

  /**
   * The day this recording is FOR. Normally the device's today; a gap row in
   * the register hands a past date through so a missed day can be written up.
   * Future dates are refused — a diary is not written in advance — and the
   * signed entry will honestly show its late signing time either way.
   */
  const targetDate = forDate && forDate <= queue.localDate() ? forDate : queue.localDate();
  const backdated = targetDate !== queue.localDate();

  // Project vocabulary, so a crew name lights Labour without the word being said.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase.rpc('project_keyterms', { p_project_id: projectId });
        if (!cancelled && Array.isArray(data)) {
          termsRef.current = { labour: data as string[], plant: data as string[] };
        }
      } catch {
        // Chips still work off the fixed cue list.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Timer.
  useEffect(() => {
    if (phase !== 'recording' && phase !== 'paused') return;
    const timer = window.setInterval(() => {
      setElapsed(recorderRef.current?.elapsedMs() ?? 0);
    }, 200);
    return () => window.clearInterval(timer);
  }, [phase]);

  // Chips follow whatever transcript exists so far.
  useEffect(() => {
    setCovered(detectSections(`${finalText} ${interim} ${typedText}`, termsRef.current));
  }, [finalText, interim, typedText]);

  const getLevel = useCallback(() => recorderRef.current?.level() ?? 0, []);

  async function start() {
    setError(null);
    setPhase('starting');

    let recorder: Recorder;
    try {
      recorder = await Recorder.create();
    } catch {
      setPhase('error');
      setError(
        'No microphone. Check the site browser has permission — on iPhone that is Settings, then the browser, then Microphone.',
      );
      return;
    }

    recorderRef.current = recorder;
    setFinalText('');
    setInterim('');
    setElapsed(0);

    if (!LIVE_TRANSCRIPT) {
      await recorder.start(250);
      setPhase('recording');
      return;
    }

    // Live transcript is best effort and must never delay the recording.
    const live = new LiveTranscriber(projectId, {
      onTranscript: (text, isFinal) => {
        if (isFinal) {
          setFinalText((prev) => (prev ? `${prev} ${text}` : text));
          setInterim('');
        } else {
          setInterim(text);
        }
      },
      onClose: () => setLiveOn(false),
    });
    liveRef.current = live;

    await recorder.start(250);
    setPhase('recording');

    // Recording is already underway. The live transcript is decoration on top
    // of it, so it connects afterwards and can fail without consequence.
    live
      .connect(recorder.sampleRate)
      .then(() => recorder.startPcmTap((frame) => live.send(frame)))
      .then((tapped) => setLiveOn(tapped))
      .catch(() => setLiveOn(false));
  }

  async function stop() {
    const recorder = recorderRef.current;
    if (!recorder) return;

    setPhase('saving');
    liveRef.current?.close();
    liveRef.current = null;

    try {
      const recording = await recorder.stop();
      recorderRef.current = null;

      if (recording.durationMs < 1500) {
        setPhase('error');
        setError('That was too short to keep. Nothing was saved.');
        return;
      }

      // Local first, always. Everything after this point is optional.
      await queue.enqueue({
        projectId,
        entryDate: targetDate,
        blob: recording.blob,
        mimeType: recording.mimeType,
        durationMs: recording.durationMs,
        recordedAt: recording.recordedAt,
      });

      setPhase('saved');
      void sync.drain();
      window.setTimeout(() => router.push('/'), 1200);
    } catch {
      setPhase('error');
      setError('The recorder stopped unexpectedly. Anything already saved is still on the phone.');
    }
  }

  async function saveText() {
    const text = typedText.trim();
    if (!text) {
      setPhase('error');
      setError('Type a diary note before saving.');
      return;
    }

    setError(null);
    setPhase('saving');

    try {
      await queue.enqueueText({
        projectId,
        entryDate: targetDate,
        text,
        writtenAt: new Date().toISOString(),
      });

      setTypedText('');
      setPhase('saved');
      void sync.drain();
      window.setTimeout(() => router.push('/'), 1200);
    } catch {
      setPhase('error');
      setError('The text could not be saved on this phone. Try again before leaving the page.');
    }
  }

  function chooseMode(nextMode: CaptureMode) {
    if (active || phase === 'paused' || phase === 'starting' || phase === 'saving') return;
    setError(null);
    setPhase('idle');
    setMode(nextMode);
  }

  function togglePause() {
    const recorder = recorderRef.current;
    if (!recorder) return;
    if (phase === 'recording') {
      recorder.pause();
      setPhase('paused');
    } else if (phase === 'paused') {
      recorder.resume();
      setPhase('recording');
    }
  }

  useEffect(() => {
    setSupported(isSupported());
  }, []);

  // Never leave the microphone open behind us.
  useEffect(() => {
    return () => {
      liveRef.current?.close();
      recorderRef.current?.dispose();
    };
  }, []);

  return (
    <main className="app-shell app-shell--narrow">
      <section className={`sheet record-sheet${active ? ' sheet--recording' : ''}`}>
      <header className="page-header">
        <div>
          <p className="label"><BrandMark size={18} /> {projectName}</p>
          <h1 className="page-title">Record diary</h1>
          <p className="mono page-subtitle">Next: {orgCode}-{targetDate}</p>
        </div>
      </header>
      {backdated && (
        <p className="notice gap" style={{ marginTop: '0.75rem' }}>
          Recording for {targetDate} — a day with no entry. The record will show it was
          signed today; that is honest, and normal for a diary written up after the fact.
        </p>
      )}

      <hr className="rule" />

      <div className="capture-switch" role="group" aria-label="Diary input method">
        <button
          className={mode === 'voice' ? 'capture-switch__option is-active' : 'capture-switch__option'}
          type="button"
          onClick={() => chooseMode('voice')}
        >
          Talk
        </button>
        <button
          className="capture-switch__option"
          type="button"
          disabled={fillingIn}
          onClick={() => void fillItIn()}
        >
          {fillingIn ? 'Opening…' : 'Fill it in'}
        </button>
      </div>

      {mode === 'voice' ? (
        <>
          <p className={`timer mono${active ? ' timer--live' : ''}`}>
            {active && <span className="recdot" aria-hidden />}
            {clock(elapsed)}
          </p>
          <Waveform getLevel={getLevel} active={active} />
        </>
      ) : (
        <label className="typed-diary">
          <span className="label">Typed diary</span>
          <textarea
            className="field typed-diary__input"
            value={typedText}
            onChange={(event) => setTypedText(event.target.value)}
            placeholder="Type it the same way you would say it: labour, plant, works, delays, weather, pours, deliveries..."
            rows={8}
            maxLength={20_000}
          />
        </label>
      )}

      <SectionChips covered={covered} />

      <hr className="rule" />

      <p className="label">
        {mode === 'text' ? 'Preview' : 'Transcript'}
        {active && !liveOn ? ' · not live — the full recording is transcribed on send' : ''}
      </p>
      <p className="transcript">
        {mode === 'text' ? typedText : finalText}
        {mode === 'voice' && interim && <span className="transcript__interim"> {interim}</span>}
        {mode === 'voice' && !finalText && !interim && (
          <span style={{ color: 'var(--ink-30)' }}>
            {active ? 'Listening…' : 'Nothing yet.'}
          </span>
        )}
        {mode === 'text' && !typedText && (
          <span style={{ color: 'var(--ink-30)' }}>Nothing typed yet.</span>
        )}
      </p>

      <hr className="rule" />

      {mode === 'voice' && !supported && (
        <p className="alert">
          This browser cannot record audio. You can still type the diary, or use Safari on
          iPhone or Chrome on Android for voice.
        </p>
      )}

      {mode === 'voice' && (phase === 'idle' || phase === 'error') ? (
        <button className="button button--record" type="button" onClick={start} disabled={!supported}>
          Start recording
        </button>
      ) : null}

      {mode === 'voice' && (phase === 'recording' || phase === 'paused') && (
        <>
          <button className="button button--record" type="button" onClick={stop}>
            Stop and save
          </button>
          <button className="button button--quiet" type="button" onClick={togglePause}>
            {phase === 'paused' ? 'Resume' : 'Pause'}
          </button>
        </>
      )}

      {mode === 'text' && (phase === 'idle' || phase === 'error') ? (
        <button className="button button--record" type="button" onClick={saveText} disabled={!textReady}>
          Save typed diary
        </button>
      ) : null}

      {phase === 'starting' && <p className="notice">Opening the microphone…</p>}
      {phase === 'saving' && <p className="notice">Saving to this phone…</p>}
      {phase === 'saved' && (
        <p className="notice">Saved on this phone. It will send itself when there is signal.</p>
      )}
      {error && <p className="alert">{error}</p>}

      <QueueStatus />
      </section>
    </main>
  );
}
