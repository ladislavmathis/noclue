import { it, expect } from 'vitest';
import { FrameProcessor } from '@ricky0123/vad-web/dist/frame-processor';
import { Message } from '@ricky0123/vad-web/dist/messages';
import { boundedVADHistory } from '../apps/extension/src/audio/vad-history';
it('30 minutes of continuous speech has bounded history and one start/end transition', async () => {
  let speech = true,
    peak = 0;
  const events: Message[] = [];
  const processor = new FrameProcessor(
    async () => ({ isSpeech: speech ? 0.99 : 0.01, notSpeech: speech ? 0.01 : 0.99 }),
    () => {},
    {
      positiveSpeechThreshold: 0.6,
      negativeSpeechThreshold: 0.45,
      preSpeechPadMs: 300,
      redemptionMs: 700,
      minSpeechMs: 150,
      submitUserSpeechOnPause: false,
    },
    32,
  );
  const trim = boundedVADHistory({ frameProcessor: processor });
  processor.resume();
  const frame = new Float32Array(512);
  const event = (ev: any) => {
    if (ev.msg === Message.FrameProcessed) trim();
    else events.push(ev.msg);
  };
  for (let i = 0; i < Math.ceil((30 * 60 * 1000) / 32); i++) {
    await processor.process(frame, event);
    peak = Math.max(peak, processor.audioBuffer.length);
  }
  expect(peak).toBeLessThanOrEqual(64);
  expect(events.filter((e) => e === Message.SpeechRealStart)).toHaveLength(1);
  expect(events.filter((e) => e === Message.SpeechEnd)).toHaveLength(0);
  speech = false;
  for (let i = 0; i < 24; i++) await processor.process(frame, event);
  expect(events.filter((e) => e === Message.SpeechEnd)).toHaveLength(1);
  expect(events.filter((e) => e === Message.VADMisfire)).toHaveLength(0);
});
it('fails clearly if an incompatible library removes the bounded-history interface', () => {
  expect(() => boundedVADHistory({})).toThrow('Unsupported speech detector');
});
