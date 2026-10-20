import { test, expect, chromium } from '@playwright/test';
import { mkdtemp, cp, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ProviderError } from '../packages/core/src/recommendations/provider';
import { buildApp } from './helpers/hub-server';

test('own speech stays local and does not block automatic answers; meeting speech creates an answer and recovers after a provider failure', async () => {
  test.setTimeout(60000);
  const profile = await mkdtemp(join(tmpdir(), 'noclue-voice-routing-'));
  const extension = join(profile, 'extension');
  await cp(resolve('apps/extension/dist-test'), extension, { recursive: true });
  async function rewrite(dir: string) {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) await rewrite(p);
      else if (e.name.endsWith('.js') || e.name === 'manifest.json') {
        const s = await readFile(p, 'utf8');
        await writeFile(p, s.replaceAll('127.0.0.1:4317', '127.0.0.1:4319'));
      }
    }
  }
  await rewrite(extension);
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const origin = `chrome-extension://${new URL(worker.url()).host}`;
    let bytes = 0,
      requests = 0,
      sequence = 0;
    let failProvider: ((e: ProviderError) => void) | undefined;
    let connections = 0;
    let emitSegment: ((s: any) => void) | undefined;
    const commitTimes: number[] = [];
    let releaseAutomatic: (() => void) | undefined;
    app = await buildApp({
      configured: true,
      recommend: async (input) => {
        requests++;
        if (requests === 1 && input.mode === 'automatic')
          await new Promise<void>((resolve) => {
            releaseAutomatic = resolve;
          });
        return {
          action: 'suggest',
          responseType: 'answer' as const,
          category: 'question',
          triggerSegmentIds: [input.segments.at(-1)!.id],
          topicKey: 'routing',
          recommendation: 'Clarify the next research step.',
          suggestedResponse: 'We should agree the scope before making a commitment.',
          groundedFactIds: [],
          missingInformation: [],
        };
      },
      transcriber: (_project, onSegment, onError) => {
        failProvider = onError;
        emitSegment = onSegment;
        return {
          connect: async () => {
            connections++;
          },
          append: (buffer) => {
            bytes += buffer.length;
          },
          commit: (accepted) => {
            accepted?.(sequence);
            commitTimes.push(Date.now());
            onSegment({
              id: `meeting-${sequence}`,
              sequence: sequence++,
              at: Date.now(),
              text: 'What should we agree next?',
              final: true,
            });
          },
          close: () => {},
        };
      },
    });
    await app.listen({ host: '127.0.0.1', port: 4319 });
    const offscreen = await context.newPage();
    const speech = (await readFile('tests/fixtures/meeting-speech.wav')).toString('base64');
    await offscreen.addInitScript(
      ({ speech }) => {
        const ac = new AudioContext();
        const streams = {
          mic: ac.createMediaStreamDestination(),
          tab: ac.createMediaStreamDestination(),
        };
        const sources: Partial<Record<'mic' | 'tab', AudioBufferSourceNode>> = {};
        const buffer = ac.decodeAudioData(
          Uint8Array.from(atob(speech), (c) => c.charCodeAt(0)).buffer,
        );
        (window as any).routeVoice = async (channel: 'mic' | 'tab', on: boolean) => {
          sources[channel]?.stop();
          delete sources[channel];
          if (on) {
            await ac.resume();
            const source = ac.createBufferSource();
            source.buffer = await buffer;
            source.loop = true;
            source.connect(streams[channel]);
            source.start();
            sources[channel] = source;
          }
        };
        navigator.mediaDevices.getUserMedia = async (constraints) =>
          streams[
            (constraints?.audio as any)?.mandatory?.chromeMediaSource === 'tab' ? 'tab' : 'mic'
          ].stream;
      },
      { speech },
    );
    await offscreen.goto(`${origin}/offscreen.html`);
    const panel = await context.newPage();
    await panel.goto(`${origin}/sidepanel.html`);
    await panel.evaluate(() =>
      chrome.runtime.sendMessage({
        target: 'offscreen',
        type: 'start',
        streamId: 'synthetic-routing',
        tabId: 42,
        settings: {
          openaiKey: 'sk-test-routing-not-a-real-key',
          consentAt: 1,
          microphoneId: '',
          project: {
            name: 'Voice routing test',
            role: 'Lead',
            goal: 'Clarify scope',
            context: 'No commitments have been made.',
            keywords: [],
            preferences: {
              tone: 'professional',
              length: 'standard',
              strictContext: true,
              silenceMs: 1800,
            },
          },
        },
      }),
    );
    const snapshot = () =>
      panel.evaluate(() => chrome.runtime.sendMessage({ target: 'offscreen', type: 'snapshot' }));
    await expect.poll(async () => (await snapshot()).micAvailable).toBe(true);
    await offscreen.evaluate(() => (window as any).routeVoice('mic', true));
    await expect.poll(async () => (await snapshot()).speaking, { timeout: 8000 }).toBe(true);
    emitSegment!({
      id: 'during-own-speech',
      sequence: sequence++,
      at: Date.now(),
      text: 'What is the next step?',
      final: true,
    });
    // Own speech never reaches the server, but it no longer holds the cue back.
    await expect.poll(() => requests, { timeout: 8000 }).toBe(1);
    expect(bytes).toBe(0);
    releaseAutomatic!();
    await expect.poll(async () => (await snapshot()).suggestions.length).toBe(1);
    expect((await snapshot()).suggestions[0].mode).toBe('automatic');
    expect((await snapshot()).speaking).toBe(true);
    await offscreen.evaluate(() => (window as any).routeVoice('mic', false));
    await expect.poll(async () => (await snapshot()).speaking).toBe(false);
    await new Promise((r) => setTimeout(r, 1200));
    expect(requests).toBe(1);
    expect(bytes).toBe(0);
    await offscreen.evaluate(() => (window as any).routeVoice('tab', true));
    await expect.poll(() => bytes, { timeout: 8000 }).toBeGreaterThan(9600);
    expect((await snapshot()).speaking).toBe(false);
    const meetingSpeechStopped = Date.now();
    await offscreen.evaluate(() => (window as any).routeVoice('tab', false));
    await expect.poll(() => requests, { timeout: 8000 }).toBe(2);
    expect(commitTimes[0] - meetingSpeechStopped).toBeGreaterThanOrEqual(1400);
    expect(commitTimes[0] - meetingSpeechStopped).toBeLessThan(4500);
    console.log(
      JSON.stringify({
        test: 'configured meeting silence',
        configuredMs: 1800,
        commitDelayMs: commitTimes[0] - meetingSpeechStopped,
      }),
    );
    await expect(panel.getByRole('button', { name: 'Answer Now' })).toBeEnabled();
    await panel.getByRole('button', { name: 'Answer Now' }).click();
    await expect.poll(() => requests).toBe(3);
    await expect.poll(async () => (await snapshot()).suggestions.length).toBe(3);
    expect((await snapshot()).suggestions[0].mode).toBe('manual');
    const oldSession = (await snapshot()).sessionId;
    const oldEmit = emitSegment!;
    failProvider!(
      new ProviderError('TRANSCRIPTION_CONNECTION', 'Simulated provider disconnect', true),
    );
    await expect.poll(async () => (await snapshot()).status).toBe('Reconnecting');
    expect((await snapshot()).segments).toEqual([]);
    expect((await snapshot()).suggestions).toEqual([]);
    await expect.poll(async () => (await snapshot()).status, { timeout: 6000 }).toBe('Listening');
    expect(connections).toBe(2);
    expect((await snapshot()).sessionId).not.toBe(oldSession);
    oldEmit({
      id: 'late-old-session',
      sequence: 99,
      at: Date.now(),
      text: 'This stale result must not return',
      final: true,
    });
    expect((await snapshot()).segments).toEqual([]);
    const bytesBefore = bytes;
    await offscreen.evaluate(() => (window as any).routeVoice('tab', true));
    await expect.poll(() => bytes).toBeGreaterThan(bytesBefore + 9600);
    await offscreen.evaluate(() => (window as any).routeVoice('tab', false));
    await expect.poll(() => requests, { timeout: 8000 }).toBe(4);
    await expect.poll(async () => (await snapshot()).suggestions.length).toBe(1);
    await panel.evaluate(() => chrome.runtime.sendMessage({ target: 'offscreen', type: 'stop' }));
    expect((await snapshot()).segments).toEqual([]);
  } finally {
    await context.close();
    await app?.close();
    await rm(profile, { recursive: true, force: true });
  }
});
