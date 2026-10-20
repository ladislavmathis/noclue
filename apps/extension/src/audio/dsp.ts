// Stateful low-pass + interpolation. State is preserved across AudioWorklet blocks.
export class Resampler {
  private ring = new Float32Array(63);
  private cursor = 0;
  private index = -1;
  private next = 0;
  private previous = 0;
  private taps: Float32Array;
  constructor(
    private sourceRate: number,
    private targetRate = 24000,
  ) {
    const cutoff = 0.45 * Math.min(1, targetRate / sourceRate),
      middle = 31;
    const weights = Array.from({ length: 63 }, (_, i) => {
      const n = i - middle;
      return (
        (n === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * n) / (Math.PI * n)) *
        (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / 62))
      );
    });
    const sum = weights.reduce((a, b) => a + b, 0);
    this.taps = Float32Array.from(weights, (x) => x / sum);
  }
  process(input: Float32Array): Float32Array {
    const out: number[] = [];
    for (const sample of input) {
      this.ring[this.cursor] = sample;
      let filtered = 0;
      for (let k = 0; k < this.taps.length; k++)
        filtered += this.taps[k] * this.ring[(this.cursor - k + 63) % 63];
      this.cursor = (this.cursor + 1) % 63;
      this.index++;
      while (this.next <= this.index) {
        const fraction = this.next - (this.index - 1);
        out.push(this.previous + (filtered - this.previous) * fraction);
        this.next += this.sourceRate / this.targetRate;
      }
      this.previous = filtered;
    }
    return Float32Array.from(out);
  }
}
export function mixMono(channels: Float32Array[]): Float32Array {
  if (!channels.length) return new Float32Array();
  const mono = new Float32Array(channels[0].length);
  for (const channel of channels)
    for (let i = 0; i < mono.length; i++) mono[i] += channel[i] / channels.length;
  return mono;
}
export function pcm16(samples: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(samples.length * 2),
    view = new DataView(buffer);
  samples.forEach((value, i) => {
    const s = Math.max(-1, Math.min(1, value));
    view.setInt16(i * 2, Math.round(s * (s < 0 ? 32768 : 32767)), true);
  });
  return buffer;
}
export class AudioGate {
  private pre: ArrayBuffer[] = [];
  private active = false;
  private bytes = 0;
  constructor(
    private send: (pcm: ArrayBuffer) => void,
    private commit: () => void,
  ) {}
  frame(frame: ArrayBuffer) {
    if (!this.active) {
      this.pre.push(frame);
      if (this.pre.length > 5) this.pre.shift();
      return;
    }
    this.append(frame);
  }
  private append(frame: ArrayBuffer) {
    this.send(frame);
    this.bytes += frame.byteLength;
    if (this.bytes >= 24000 * 2 * 15) {
      this.commit();
      this.bytes = 0;
    }
  }
  speech(start: boolean) {
    if (start && !this.active) {
      this.active = true;
      for (const frame of this.pre) this.append(frame);
      this.pre = [];
    } else if (!start && this.active) {
      this.active = false;
      if (this.bytes >= 4800) this.commit();
      this.bytes = 0;
    }
  }
  reset() {
    this.pre = [];
    this.active = false;
    this.bytes = 0;
  }
}
