'use client';

import { floatToInt16 } from './pcm';

/**
 * MediaRecorder wrapper (brief §2 — not the Web Speech API: iOS Safari support
 * is unreliable and it gives no control over the vocabulary).
 *
 * Two taps on one microphone:
 *
 *   * MediaRecorder produces the file. That blob is the record — it goes to
 *     IndexedDB, then to storage, then through batch transcription.
 *   * A Web Audio graph produces raw PCM for the live transcript. This is
 *     separate on purpose: iOS Safari's MediaRecorder emits fragmented MP4,
 *     which Deepgram's streaming endpoint will not accept, so feeding the
 *     socket from the recorder works on Android and silently does nothing on
 *     iPhone. Raw linear16 off the audio graph works everywhere.
 *
 * The same graph drives the waveform, so there is one AudioContext, not two.
 */

export interface Recording {
  blob: Blob;
  mimeType: string;
  durationMs: number;
  recordedAt: string;
}

const PREFERRED_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4', // iOS Safari
  'audio/ogg;codecs=opus',
];

/**
 * Speech models work at 16 kHz, and a site on one bar does not need 48.
 * Requesting it on the context lets the browser do the resampling properly;
 * where the hint is ignored we simply stream at whatever rate we were given
 * and tell Deepgram which one it is.
 */
const PREFERRED_SAMPLE_RATE = 16_000;

/** ~128 ms at 16 kHz: quick enough to keep up with talking, not chatty. */
const PCM_FRAME_SAMPLES = 2048;

const WORKLET_URL = '/pcm-worklet.js';

export function pickMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const type of PREFERRED_TYPES) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return '';
}

export function extensionFor(mimeType: string): string {
  if (mimeType.includes('webm')) return 'webm';
  if (mimeType.includes('mp4')) return 'm4a';
  if (mimeType.includes('ogg')) return 'ogg';
  return 'bin';
}

export function isSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function' &&
    typeof MediaRecorder !== 'undefined'
  );
}

type AudioContextCtor = typeof AudioContext;

function createAudioContext(): AudioContext | null {
  const Ctor: AudioContextCtor | undefined =
    typeof window === 'undefined'
      ? undefined
      : (window.AudioContext ??
        (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext);
  if (!Ctor) return null;

  try {
    return new Ctor({ sampleRate: PREFERRED_SAMPLE_RATE });
  } catch {
    // Older Safari rejects a sample rate it cannot honour outright.
    try {
      return new Ctor();
    } catch {
      return null;
    }
  }
}

export type PcmListener = (frame: Int16Array) => void;

export class Recorder {
  private chunks: Blob[] = [];
  private startedAt = 0;
  private pausedTotal = 0;
  private pausedAt: number | null = null;

  private source: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private levelBuffer: Uint8Array<ArrayBuffer> | null = null;

  private pcmNode: AudioWorkletNode | ScriptProcessorNode | null = null;
  private pcmSink: GainNode | null = null;

  private wakeLock: WakeLockSentinel | null = null;

  private constructor(
    private stream: MediaStream,
    private recorder: MediaRecorder,
    private audioContext: AudioContext | null,
    readonly mimeType: string,
  ) {}

  static async create(): Promise<Recorder> {
    // Built before the await so it is created inside the user gesture that
    // started the recording — Safari will not let it start otherwise.
    const audioContext = createAudioContext();

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        // A site is loud and windy; let the browser do what it can.
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    const mimeType = pickMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    return new Recorder(stream, recorder, audioContext, recorder.mimeType || mimeType);
  }

  /** The rate the live socket has to be told about. */
  get sampleRate(): number {
    return this.audioContext?.sampleRate ?? PREFERRED_SAMPLE_RATE;
  }

  async start(timesliceMs = 250) {
    this.chunks = [];
    this.pausedTotal = 0;
    this.pausedAt = null;

    this.recorder.ondataavailable = (event) => {
      if (!event.data || event.data.size === 0) return;
      this.chunks.push(event.data);
    };

    this.buildAudioGraph();
    this.recorder.start(timesliceMs);
    this.startedAt = Date.now();

    // A screen lock kills the recorder mid-sentence. Best effort — not
    // supported everywhere, and never a reason to fail the recording.
    try {
      this.wakeLock = (await navigator.wakeLock?.request('screen')) ?? null;
    } catch {
      this.wakeLock = null;
    }
  }

  /**
   * Start streaming linear16 to `listener`. Resolves false when the browser
   * has no usable audio graph — the recording is unaffected either way.
   */
  async startPcmTap(listener: PcmListener): Promise<boolean> {
    const context = this.audioContext;
    const source = this.source;
    if (!context || !source || this.pcmNode) return false;

    try {
      if (context.state === 'suspended') await context.resume();

      // Worklet and ScriptProcessor nodes are both pulled by the destination,
      // so the graph has to reach it — at zero gain, or the site hears itself.
      const sink = context.createGain();
      sink.gain.value = 0;
      sink.connect(context.destination);
      this.pcmSink = sink;

      if (typeof AudioWorkletNode !== 'undefined' && context.audioWorklet) {
        await context.audioWorklet.addModule(WORKLET_URL);
        const node = new AudioWorkletNode(context, 'pcm-tap', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [1],
          processorOptions: { frameSize: PCM_FRAME_SAMPLES },
        });
        node.port.onmessage = (event: MessageEvent<Float32Array>) => {
          listener(floatToInt16(event.data));
        };
        source.connect(node);
        node.connect(sink);
        this.pcmNode = node;
        return true;
      }

      return this.startScriptProcessorTap(context, source, sink, listener);
    } catch {
      // Some older Android WebViews have audioWorklet but fail to load a
      // module. Try the deprecated path before giving up on the live text.
      try {
        if (this.audioContext && this.source && this.pcmSink) {
          return this.startScriptProcessorTap(
            this.audioContext,
            this.source,
            this.pcmSink,
            listener,
          );
        }
      } catch {
        // No live transcript. The recording is untouched.
      }
      this.stopPcmTap();
      return false;
    }
  }

  private startScriptProcessorTap(
    context: AudioContext,
    source: MediaStreamAudioSourceNode,
    sink: GainNode,
    listener: PcmListener,
  ): boolean {
    if (typeof context.createScriptProcessor !== 'function') return false;

    const node = context.createScriptProcessor(4096, 1, 1);
    node.onaudioprocess = (event) => {
      // getChannelData returns a view the graph reuses; floatToInt16 copies.
      listener(floatToInt16(event.inputBuffer.getChannelData(0)));
    };
    source.connect(node);
    node.connect(sink);
    this.pcmNode = node;
    return true;
  }

  stopPcmTap() {
    if (this.pcmNode) {
      if ('port' in this.pcmNode) {
        this.pcmNode.port.onmessage = null;
      } else {
        this.pcmNode.onaudioprocess = null;
      }
      try {
        this.pcmNode.disconnect();
      } catch {
        // already gone
      }
      this.pcmNode = null;
    }
    try {
      this.pcmSink?.disconnect();
    } catch {
      // already gone
    }
    this.pcmSink = null;
  }

  pause() {
    if (this.recorder.state !== 'recording') return;
    this.recorder.pause();
    this.pausedAt = Date.now();
  }

  resume() {
    if (this.recorder.state !== 'paused') return;
    this.recorder.resume();
    if (this.pausedAt) this.pausedTotal += Date.now() - this.pausedAt;
    this.pausedAt = null;
  }

  get state(): RecordingState {
    return this.recorder.state;
  }

  /** Elapsed recording time, excluding anything spent paused. */
  elapsedMs(): number {
    if (!this.startedAt) return 0;
    const paused = this.pausedTotal + (this.pausedAt ? Date.now() - this.pausedAt : 0);
    return Date.now() - this.startedAt - paused;
  }

  /** 0..1 loudness, for the waveform. */
  level(): number {
    if (!this.analyser || !this.levelBuffer) return 0;
    this.analyser.getByteTimeDomainData(this.levelBuffer);
    let peak = 0;
    for (let i = 0; i < this.levelBuffer.length; i += 1) {
      peak = Math.max(peak, Math.abs(this.levelBuffer[i] - 128));
    }
    return Math.min(1, peak / 96);
  }

  stop(): Promise<Recording> {
    return new Promise((resolve, reject) => {
      if (this.recorder.state === 'inactive') {
        reject(new Error('Not recording.'));
        return;
      }

      const durationMs = this.elapsedMs();

      this.recorder.onstop = () => {
        const mimeType = this.mimeType || 'audio/webm';
        const blob = new Blob(this.chunks, { type: mimeType });
        this.teardown();
        resolve({ blob, mimeType, durationMs, recordedAt: new Date().toISOString() });
      };
      this.recorder.onerror = () => {
        this.teardown();
        reject(new Error('The recorder stopped unexpectedly.'));
      };

      this.recorder.stop();
    });
  }

  /** Abandon without producing a recording. */
  dispose() {
    try {
      if (this.recorder.state !== 'inactive') this.recorder.stop();
    } catch {
      // already stopped
    }
    this.teardown();
  }

  private buildAudioGraph() {
    const context = this.audioContext;
    if (!context) return;
    try {
      this.source = context.createMediaStreamSource(this.stream);
      this.analyser = context.createAnalyser();
      this.analyser.fftSize = 1024;
      this.levelBuffer = new Uint8Array(new ArrayBuffer(this.analyser.fftSize));
      this.source.connect(this.analyser);
    } catch {
      // No waveform and no live transcript is survivable; a failed recording
      // is not. Both are decoration on top of the blob.
      this.source = null;
      this.analyser = null;
    }
  }

  private teardown() {
    this.stopPcmTap();
    try {
      this.source?.disconnect();
    } catch {
      // already gone
    }
    this.source = null;
    this.analyser = null;
    this.stream.getTracks().forEach((track) => track.stop());
    void this.audioContext?.close().catch(() => {});
    void this.wakeLock?.release().catch(() => {});
    this.wakeLock = null;
  }
}
