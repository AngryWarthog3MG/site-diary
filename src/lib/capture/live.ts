'use client';

/**
 * Live transcript for the recording screen.
 *
 * Display only. What lands in the record always comes from the batch pass over
 * the complete file — so a dropped socket, a flat token or no signal at all
 * costs the supervisor the on-screen feedback and nothing else.
 *
 * The token is a 60-second JWT minted server-side and passed as `access_token`
 * on the URL. It does not go in `Sec-WebSocket-Protocol`: these JWTs are long
 * enough that browsers reject the handshake outright when they are sent as a
 * subprotocol.
 *
 * Audio arrives as raw linear16 straight off the recorder's audio graph, not
 * as MediaRecorder output — iOS Safari produces fragmented MP4, which the
 * streaming endpoint rejects.
 */

const DEEPGRAM_WS = 'wss://api.deepgram.com/v1/listen';
const KEEPALIVE_MS = 8_000;

/**
 * Stop feeding the socket once this much is queued in the browser. On one bar
 * of signal the send buffer grows faster than it drains, and a transcript that
 * is a minute behind is worse than one with a gap in it — the recording is
 * unaffected either way, and the batch pass is what becomes the record.
 */
const MAX_BUFFERED_BYTES = 512 * 1024;

export interface LiveEvents {
  onTranscript?: (text: string, isFinal: boolean) => void;
  onError?: (message: string) => void;
  onOpen?: () => void;
  onClose?: () => void;
}

export class LiveTranscriber {
  private socket: WebSocket | null = null;
  private keepAlive: number | null = null;
  private closing = false;

  constructor(
    private readonly projectId: string,
    private readonly events: LiveEvents = {},
  ) {}

  get ready(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  /** `sampleRate` is whatever the browser's AudioContext actually gave us. */
  async connect(sampleRate: number): Promise<void> {
    const response = await fetch('/api/deepgram/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: this.projectId, sampleRate }),
    });

    if (!response.ok) {
      throw new Error('Live transcript unavailable.');
    }

    const { accessToken, query } = (await response.json()) as {
      accessToken: string;
      query: string;
    };

    const url = `${DEEPGRAM_WS}?${query}&access_token=${encodeURIComponent(accessToken)}`;

    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(url);
      socket.binaryType = 'arraybuffer';

      const failed = () => reject(new Error('Could not open the live transcript.'));

      socket.onopen = () => {
        socket.onerror = () => this.events.onError?.('Live transcript dropped out.');
        this.keepAlive = window.setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'KeepAlive' }));
          }
        }, KEEPALIVE_MS);
        this.events.onOpen?.();
        resolve();
      };

      socket.onerror = failed;

      socket.onmessage = (event) => {
        if (typeof event.data !== 'string') return;
        try {
          const message = JSON.parse(event.data) as DeepgramLiveMessage;
          if (message.type !== 'Results') return;
          const text = message.channel?.alternatives?.[0]?.transcript ?? '';
          if (!text) return;
          this.events.onTranscript?.(text, Boolean(message.is_final));
        } catch {
          // A malformed frame is not worth interrupting a recording over.
        }
      };

      socket.onclose = () => {
        this.clearKeepAlive();
        this.events.onClose?.();
        if (!this.closing) failed();
      };

      this.socket = socket;
    });
  }

  /** Feed one frame of linear16 straight through. */
  send(frame: Int16Array) {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    if (socket.bufferedAmount > MAX_BUFFERED_BYTES) return;
    socket.send(frame.buffer as ArrayBuffer);
  }

  close() {
    this.closing = true;
    this.clearKeepAlive();
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: 'CloseStream' }));
      this.socket.close();
    }
    this.socket = null;
  }

  private clearKeepAlive() {
    if (this.keepAlive !== null) {
      window.clearInterval(this.keepAlive);
      this.keepAlive = null;
    }
  }
}

interface DeepgramLiveMessage {
  type?: string;
  is_final?: boolean;
  channel?: { alternatives?: Array<{ transcript?: string }> };
}
