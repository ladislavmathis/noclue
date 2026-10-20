import { describe, it, expect } from 'vitest';
import { AudioGate, Resampler, mixMono, pcm16 } from '../apps/extension/src/audio/dsp';
describe('audio pipeline', () => {
  for (const rate of [44100, 48000])
    it(`resamples ${rate}Hz continuously without block-boundary drift`, () => {
      const input = Float32Array.from(
        { length: rate },
        (_, i) => 0.5 * Math.sin((2 * Math.PI * 440 * i) / rate),
      );
      const one = new Resampler(rate).process(input);
      const stream = new Resampler(rate),
        values: number[] = [];
      for (let i = 0; i < input.length; i += 128)
        values.push(...stream.process(input.slice(i, i + 128)));
      expect(Math.abs(values.length - 24000)).toBeLessThanOrEqual(1);
      expect(values).toEqual(Array.from(one));
      const rms = Math.sqrt(
        values.slice(100).reduce((s, x) => s + x * x, 0) / (values.length - 100),
      );
      expect(rms).toBeCloseTo(0.5 / Math.sqrt(2), 2);
    });
  it('filters out frequencies above the output Nyquist limit', () => {
    const r = new Resampler(48000),
      out = r.process(
        Float32Array.from({ length: 48000 }, (_, i) => Math.sin((2 * Math.PI * 18000 * i) / 48000)),
      );
    expect(
      Math.sqrt(out.slice(100).reduce((s, x) => s + x * x, 0) / (out.length - 100)),
    ).toBeLessThan(0.01);
  });
  it('mixes channels and clips signed little-endian PCM', () => {
    expect([...mixMono([new Float32Array([1, -1]), new Float32Array([-1, 1])])]).toEqual([0, 0]);
    const view = new DataView(pcm16(new Float32Array([-2, -1, 0, 1, 2])));
    expect(Array.from({ length: 5 }, (_, i) => view.getInt16(i * 2, true))).toEqual([
      -32768, -32768, 0, 32767, 32767,
    ]);
  });
  it('never commits silence, keeps only bounded preroll and commits once on speech end', () => {
    const frames: ArrayBuffer[] = [],
      commits: number[] = [];
    const gate = new AudioGate(
      (x) => frames.push(x),
      () => commits.push(frames.length),
    );
    for (let i = 0; i < 100; i++) gate.frame(new ArrayBuffer(4800));
    gate.speech(false);
    expect(frames).toHaveLength(0);
    expect(commits).toHaveLength(0);
    gate.speech(true);
    expect(frames).toHaveLength(5);
    gate.frame(new ArrayBuffer(4800));
    gate.speech(false);
    gate.speech(false);
    expect(commits).toEqual([6]);
  });
  it('splits long speech at 15 seconds without duplication and discards buffered gaps', () => {
    let bytes = 0,
      commits = 0;
    const gate = new AudioGate(
      (x) => (bytes += x.byteLength),
      () => commits++,
    );
    gate.speech(true);
    for (let i = 0; i < 151; i++) gate.frame(new ArrayBuffer(4800));
    expect(commits).toBe(1);
    gate.speech(false);
    expect(commits).toBe(2);
    expect(bytes).toBe(151 * 4800);
    gate.frame(new ArrayBuffer(4800));
    gate.reset();
    gate.speech(true);
    expect(bytes).toBe(151 * 4800);
  });
});
