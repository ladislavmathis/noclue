import { boundedVADHistory } from './vad-history';
import { MicVAD } from '@ricky0123/vad-web';
export async function createVAD(
  stream: MediaStream,
  context: AudioContext,
  callbacks: {
    speech: (active: boolean, speechAt?: number) => void;
    level: (value: number) => void;
  },
  silenceMs = 700,
) {
  let lastVoicedAt = performance.timeOrigin + performance.now();
  let trimHistory = () => {};
  const detector = await MicVAD.new({
    model: 'v5',
    startOnLoad: false,
    processorType: 'AudioWorklet',
    audioContext: context,
    baseAssetPath: chrome.runtime.getURL('vad/'),
    onnxWASMBasePath: chrome.runtime.getURL('vad/'),
    ortConfig: (ort) => {
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.proxy = false;
    },
    getStream: async () => stream,
    pauseStream: async () => {},
    resumeStream: async () => stream,
    minSpeechMs: 150,
    redemptionMs: silenceMs,
    preSpeechPadMs: 300,
    submitUserSpeechOnPause: false,
    positiveSpeechThreshold: 0.6,
    negativeSpeechThreshold: 0.45,
    onSpeechRealStart: () => callbacks.speech(true, performance.timeOrigin + performance.now()),
    onSpeechEnd: () => callbacks.speech(false, lastVoicedAt),
    onVADMisfire: () => callbacks.speech(false, lastVoicedAt),
    onFrameProcessed: (prob, frame) => {
      if (prob.isSpeech >= 0.45) lastVoicedAt = performance.timeOrigin + performance.now();
      trimHistory();
      let energy = 0;
      for (const n of frame) energy += n * n;
      callbacks.level(Math.min(1, Math.sqrt(energy / frame.length) * 6));
    },
  });
  try {
    trimHistory = boundedVADHistory(detector);
    return detector;
  } catch (error) {
    await detector.destroy();
    throw error;
  }
}
