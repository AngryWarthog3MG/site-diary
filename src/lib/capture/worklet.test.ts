import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { floatToInt16 } from './pcm.ts';

/**
 * The PCM worklet runs on the audio thread, where it cannot be reached from a
 * browser test — but its job is pure buffering arithmetic, and getting it
 * wrong drops or repeats audio in a way nobody would notice until a transcript
 * came back stuttering. So it is loaded here against a fake AudioWorklet host.
 */

interface FakeProcessor {
  port: { postMessage: (data: Float32Array, transfer?: ArrayBuffer[]) => void };
  process(inputs: Float32Array[][]): boolean;
}

type ProcessorCtor = new (options?: {
  processorOptions?: { frameSize?: number };
}) => FakeProcessor;

function loadWorklet(): ProcessorCtor {
  const source = readFileSync('public/pcm-worklet.js', 'utf8');
  let registered: ProcessorCtor | null = null;

  class FakeAudioWorkletProcessor {
    port = {
      postMessage: () => {},
    };
  }

  const load = new Function('registerProcessor', 'AudioWorkletProcessor', source);
  load(
    (_name: string, ctor: ProcessorCtor) => {
      registered = ctor;
    },
    FakeAudioWorkletProcessor,
  );

  assert.ok(registered, 'the worklet did not register a processor');
  return registered;
}

function collect(frameSize: number) {
  const Processor = loadWorklet();
  const processor = new Processor({ processorOptions: { frameSize } });
  const frames: number[][] = [];
  processor.port.postMessage = (data) => frames.push([...data]);
  return { processor, frames };
}

test('re-frames awkward render quanta into exact frames', () => {
  const { processor, frames } = collect(8);

  // 128-sample quanta never divide evenly into the send frame; feed threes.
  let next = 0;
  for (let i = 0; i < 7; i += 1) {
    processor.process([[new Float32Array(3).map(() => next++)]]);
  }

  assert.ok(frames.length > 0, 'nothing was emitted');
  assert.ok(
    frames.every((f) => f.length === 8),
    'a short frame escaped',
  );

  // Every sample, in order, exactly once — no gaps, no repeats.
  const flat = frames.flat();
  assert.deepEqual(
    flat,
    Array.from({ length: flat.length }, (_, i) => i),
  );
});

test('holds a partial frame back rather than padding it with silence', () => {
  const { processor, frames } = collect(2048);
  processor.process([[new Float32Array(128).fill(0.5)]]);
  assert.equal(frames.length, 0, 'emitted before the frame was full');
});

test('survives an empty or absent input', () => {
  const { processor, frames } = collect(8);
  assert.equal(processor.process([[]]), true);
  assert.equal(processor.process([]), true);
  assert.equal(frames.length, 0);
});

test('keeps processing — returning false would tear the node down', () => {
  const { processor } = collect(8);
  for (let i = 0; i < 50; i += 1) {
    assert.equal(processor.process([[new Float32Array(128)]]), true);
  }
});

test('a full-scale frame survives the trip to linear16 intact', () => {
  const { processor, frames } = collect(4);
  processor.process([[new Float32Array([1, -1, 0, 0.5])]]);
  assert.equal(frames.length, 1);
  assert.deepEqual([...floatToInt16(new Float32Array(frames[0]))], [32767, -32768, 0, 16383]);
});
