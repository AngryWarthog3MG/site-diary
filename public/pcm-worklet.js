/*
 * Raw PCM tap for the live transcript.
 *
 * iOS Safari's MediaRecorder emits fragmented MP4, which Deepgram's streaming
 * endpoint will not accept — so the live socket is fed from the audio graph
 * instead of from the recorder. This runs on the audio thread, buffers the
 * 128-sample render quantum up to something worth sending, and posts it across
 * as a transferable so nothing is copied.
 *
 * Deliberately does no conversion: the main thread turns these floats into
 * linear16 with the shared, unit-tested helper in src/lib/capture/pcm.ts, so
 * the worklet path and the ScriptProcessor fallback cannot drift apart.
 */

class PcmTap extends AudioWorkletProcessor {
  constructor(options) {
    super();
    // ~128 ms at 16 kHz. Small enough that the transcript keeps up with the
    // talking, large enough not to post a message every 8 ms.
    this.frameSize = options?.processorOptions?.frameSize ?? 2048;
    this.buffer = new Float32Array(this.frameSize);
    this.filled = 0;
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;

    let offset = 0;
    while (offset < channel.length) {
      const take = Math.min(this.frameSize - this.filled, channel.length - offset);
      this.buffer.set(channel.subarray(offset, offset + take), this.filled);
      this.filled += take;
      offset += take;

      if (this.filled === this.frameSize) {
        const frame = this.buffer;
        this.port.postMessage(frame, [frame.buffer]);
        // postMessage detached the old buffer; start a fresh one.
        this.buffer = new Float32Array(this.frameSize);
        this.filled = 0;
      }
    }

    return true;
  }
}

registerProcessor('pcm-tap', PcmTap);
