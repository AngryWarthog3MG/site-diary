/**
 * Float32 audio (what the Web Audio API deals in) to linear16 (what Deepgram's
 * streaming endpoint wants).
 *
 * Shared by both live capture paths — the AudioWorklet and the
 * ScriptProcessor fallback — so there is one implementation to get right.
 */

/**
 * Convert to signed 16-bit little-endian PCM.
 *
 * Clamps before scaling: Web Audio does not guarantee samples stay inside
 * [-1, 1], and an out-of-range value that is allowed to wrap turns a loud
 * moment into a burst of noise. Negative and positive are scaled by 32768 and
 * 32767 respectively so that -1.0 and +1.0 both land on the rail rather than
 * overflowing it.
 */
export function floatToInt16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    out[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return out;
}
