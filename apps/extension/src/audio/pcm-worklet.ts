import { Resampler, mixMono, pcm16 } from './dsp';
declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, processor: typeof AudioWorkletProcessor): void;
class PCMProcessor extends AudioWorkletProcessor {
  private resampler = new Resampler(sampleRate);
  private block = new Float32Array(2400);
  private offset = 0;
  process(inputs: Float32Array[][]) {
    const channels = inputs[0];
    if (!channels?.length) return true;
    for (const sample of this.resampler.process(mixMono(channels))) {
      this.block[this.offset++] = sample;
      if (this.offset === this.block.length) {
        const pcm = pcm16(this.block);
        this.port.postMessage(pcm, [pcm]);
        this.offset = 0;
      }
    }
    return true;
  }
}
registerProcessor('noclue-pcm', PCMProcessor);
