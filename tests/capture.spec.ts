import { test, expect, chromium } from '@playwright/test';
import { mkdtemp, readFile, rm, cp, readdir, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { buildApp } from './helpers/hub-server';

test('production Chrome tabCapture → local VAD → PCM → hub → recommendation → Stop', async ({}, testInfo) => {
  const soakSeconds = Number(process.env.NOCLUE_SOAK_SECONDS ?? 0);
  if (!Number.isFinite(soakSeconds) || soakSeconds < 0 || soakSeconds > 3600)
    throw new Error('NOCLUE_SOAK_SECONDS must be 0–3600');
  test.setTimeout((soakSeconds + 90) * 1000);
  const profile = await mkdtemp(join(tmpdir(), 'noclue-capture-'));
  const testPort = Number(process.env.NOCLUE_TEST_PORT ?? 4327);
  if (!Number.isInteger(testPort) || testPort < 1024 || testPort > 65535)
    throw new Error('NOCLUE_TEST_PORT must be a local port from 1024 to 65535');
  // Test build: same app, but its hub runs in this test process with fake AI providers.
  let extension = resolve('apps/extension/dist-test');
  if (testPort !== 4317) {
    const copied = join(profile, 'isolated-extension');
    await cp(extension, copied, { recursive: true });
    // Only the loopback destination changes; capture, VAD and lifecycle code
    // remain the built application. The user's installed extension is untouched.
    async function rewriteEndpoint(directory: string) {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) await rewriteEndpoint(path);
        else if (entry.name.endsWith('.js') || entry.name === 'manifest.json') {
          const source = await readFile(path, 'utf8');
          const changed = source.replaceAll('127.0.0.1:4317', `127.0.0.1:${testPort}`);
          if (changed !== source) await writeFile(path, changed);
        }
      }
    }
    await rewriteEndpoint(copied);
    extension = copied;
  }
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    ignoreDefaultArgs: ['--mute-audio'],
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
      '--enable-unsafe-extension-debugging',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const id = new URL(worker.url()).host,
      origin = `chrome-extension://${id}`;
    const technical = [
      'What is the review pipeline?',
      'How is uncertainty communicated?',
      'What will the pilot show?',
      'What happens with insufficient evidence?',
      'Can it plan further verification?',
      'What is the evidence model?',
    ];
    const soakQuestions = [
      ...Array.from({ length: 30 }, (_, i) => technical[Math.floor(i / 5)]),
      ...Array(5).fill('What is calibrated uncertainty?'),
      ...Array(5).fill('What are my responsibilities?'),
      ...Array(5).fill('What is the review pipeline?'),
    ];
    let soakMode = false,
      soakQuestionCount = 0;
    const soakTasks: Promise<void>[] = [];
    const soakReplies: string[] = [];
    let bytes = 0,
      energy = 0,
      commits = 0,
      sequence = 0;
    app = await buildApp({
      configured: true,
      recommend: async (input) => {
        if (soakMode) soakReplies.push(input.question!);
        return {
          action: 'suggest',
          responseType: 'answer' as const,
          category: 'objection',
          triggerSegmentIds: [input.segments.at(-1)!.id],
          topicKey: 'pilot-scalability',
          recommendation: 'Explain the planned pilot validation.',
          suggestedResponse: soakMode
            ? `Synthetic answer for: ${input.question}`
            : 'We propose using the pilot to validate scalability before expanding.',
          groundedFactIds: [],
          missingInformation: [],
        };
      },
      transcriber: (_project, onSegment) => ({
        connect: async () => {},
        append: (audio) => {
          bytes += audio.length;
          const view = new DataView(audio.buffer, audio.byteOffset, audio.byteLength);
          for (let i = 0; i + 1 < audio.length; i += 2) energy += Math.abs(view.getInt16(i, true));
        },
        commit: (accepted) => {
          accepted?.(sequence);
          commits++;
          const segmentId = `captured-${sequence}`;
          onSegment({
            id: segmentId,
            sequence: sequence++,
            text: soakMode
              ? soakQuestions[soakQuestionCount++ % soakQuestions.length]
              : 'We are concerned about scalability. How will the pilot help?',
            at: Date.now(),
            final: true,
          });
          if (soakMode) {
            const task = (async () => {
              await expect
                .poll(
                  async () => {
                    const snapshot = await panel.evaluate(() =>
                      chrome.runtime.sendMessage({ target: 'offscreen', type: 'snapshot' }),
                    );
                    return snapshot.question?.segmentIds.includes(segmentId) ?? false;
                  },
                  { timeout: 3000 },
                )
                .toBe(true);
              await panel.evaluate(() =>
                chrome.runtime.sendMessage({ target: 'offscreen', type: 'answer' }),
              );
            })();
            task.catch(() => {}); // Await and report all failures before Stop.
            soakTasks.push(task);
          }
        },
        close: () => {},
      }),
    });
    await app.listen({ host: '127.0.0.1', port: testPort });
    const speech = (await readFile('tests/fixtures/meeting-speech.wav')).toString('base64');
    await context.route('https://meet.google.com/noclue-test', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><title>noclue synthetic meeting</title><h1>Local speech fixture — not a Google Meet call</h1><button id="play">Play participant speech</button><audio id="speech" src="data:audio/wav;base64,${speech}"></audio><script>const audio=document.querySelector('audio');document.querySelector('button').onclick=async()=>{const ac=new AudioContext();globalThis.fixtureAudio=ac;await ac.resume();const decoded=await ac.decodeAudioData(await (await fetch(audio.src)).arrayBuffer());const buffer=ac.createBuffer(decoded.numberOfChannels,decoded.length+ac.sampleRate,ac.sampleRate);for(let c=0;c<decoded.numberOfChannels;c++)buffer.copyToChannel(decoded.getChannelData(c),c);const source=ac.createBufferSource();source.buffer=buffer;source.loop=true;source.connect(ac.destination);source.start();};</script>`,
      }),
    );
    const panel = await context.newPage();
    await panel.goto(`${origin}/sidepanel.html`);
    const settings = {
      testMode: true,
      openaiKey: 'sk-test-capture-fixture-not-a-real-key',
      answerProvider: 'openai',
      answerModel: '',
      anthropicKey: '',
      consentAt: 1,
      microphoneId: 'noclue-test-no-physical-microphone',
      project: {
        name: 'Synthetic capture acceptance',
        role: 'Project lead',
        goal: 'Clarify pilot',
        context: 'A pilot is planned to validate scalability; no results exist.',
        keywords: [],
      },
    };
    await panel.evaluate((settings) => chrome.storage.local.set({ settings }), settings);
    const meet = await context.newPage();
    await meet.goto('https://meet.google.com/noclue-test');
    await meet.getByRole('button', { name: 'Play participant speech' }).click();
    await meet.bringToFront();
    const browserCdp = await context.browser()!.newBrowserCDPSession();
    await browserCdp.send('Browser.setPermission', {
      permission: { name: 'microphone' },
      setting: 'denied',
      origin,
    });
    const targets = await browserCdp.send('Target.getTargets', {
      filter: [{ type: 'tab', exclude: false }],
    });
    const tabTarget = targets.targetInfos.find((t) => t.url === meet.url());
    expect(tabTarget).toBeDefined();
    const [selected] = await worker.evaluate(() =>
      chrome.tabs.query({ active: true, currentWindow: true }),
    );
    await browserCdp.send('Extensions.triggerAction', { id, targetId: tabTarget!.targetId });
    await worker.evaluate((id) => chrome.tabs.update(id!, { active: true }), selected.id);

    // The browser action above grants activeTab on the actual selected tab.
    // This sends the same command as Start Listening, with no capture/media API replacement.
    const result = await panel.evaluate(
      (settings) => chrome.runtime.sendMessage({ target: 'background', type: 'start', settings }),
      settings,
    );
    expect(result.error ?? '').toBe('');
    await expect
      .poll(
        async () => {
          const state = await panel.evaluate(() =>
            chrome.runtime.sendMessage({ target: 'offscreen', type: 'snapshot' }),
          );
          if (state.status === 'Error') throw new Error(JSON.stringify(state));
          return state.status;
        },
        { timeout: 20000 },
      )
      .toBe('Listening');
    await expect.poll(() => bytes, { timeout: 25000 }).toBeGreaterThan(9600);
    expect(energy).toBeGreaterThan(0);
    await expect.poll(() => commits, { timeout: 25000 }).toBeGreaterThan(0);
    await panel.evaluate(() => chrome.runtime.sendMessage({ target: 'offscreen', type: 'answer' }));
    await expect
      .poll(
        async () =>
          panel.evaluate(
            async () =>
              (await chrome.runtime.sendMessage({ target: 'offscreen', type: 'snapshot' }))
                .suggestions.length,
          ),
        { timeout: 15000 },
      )
      .toBeGreaterThan(0);
    const shown = await panel.evaluate(() =>
      chrome.runtime.sendMessage({ target: 'background', type: 'overlay' }),
    );
    expect(shown.error ?? '').toBe('');
    await expect(meet.locator('#noclue-cue')).toBeVisible();
    await expect(meet.locator('#noclue-cue .answer')).toContainText('We propose using the pilot');
    await expect
      .poll(async () => {
        const log = await panel.evaluate(() =>
          chrome.runtime.sendMessage({ target: 'offscreen', type: 'test.export' }),
        );
        return log.events.filter((e: { kind: string }) => e.kind === 'quick.visible').length;
      })
      .toBe(1);
    await meet.locator('#noclue-cue [data-feedback="helpful"]').click();
    await expect
      .poll(async () => {
        const log = await panel.evaluate(() =>
          chrome.runtime.sendMessage({ target: 'offscreen', type: 'test.export' }),
        );
        return log.events.some((e: { kind: string }) => e.kind === 'feedback');
      })
      .toBe(true);
    await meet.getByRole('slider', { name: 'Cue opacity' }).fill('65');
    await expect(meet.locator('#noclue-cue')).toHaveCSS('opacity', '0.65');
    await meet.getByRole('button', { name: 'Minimize cue' }).click();
    await expect(meet.locator('#noclue-cue .answer')).not.toBeVisible();
    await meet.getByRole('button', { name: 'Expand cue' }).click();
    const header = meet.getByLabel('Move cue window with arrow keys');
    await header.focus();
    await header.press('ArrowRight');
    await expect(meet.locator('#noclue-cue')).toHaveCSS('left', '30px');
    await expect
      .poll(() =>
        panel.evaluate(
          async () => (await chrome.storage.local.get('cueLayout')).cueLayout?.opacity,
        ),
      )
      .toBe(65);
    await meet.getByRole('button', { name: 'Hide cue' }).click();
    await expect(meet.locator('#noclue-cue')).toHaveCount(0);
    await panel.evaluate(() =>
      chrome.runtime.sendMessage({ target: 'background', type: 'overlay' }),
    );
    await expect(meet.locator('#noclue-cue')).toHaveCSS('opacity', '0.65');
    const cueBounds = await meet.locator('#noclue-cue').boundingBox();
    await meet.mouse.move(
      cueBounds!.x + cueBounds!.width - 3,
      cueBounds!.y + cueBounds!.height - 3,
    );
    await meet.mouse.down();
    await meet.mouse.move(
      cueBounds!.x + cueBounds!.width + 60,
      cueBounds!.y + cueBounds!.height + 35,
      { steps: 5 },
    );
    await meet.mouse.up();
    await expect
      .poll(async () => (await meet.locator('#noclue-cue').boundingBox())!.width)
      .toBeGreaterThan(cueBounds!.width + 30);
    await meet.screenshot({ path: testInfo.outputPath('cue-overlay.png') });
    // Chrome may retire the service worker while a meeting is running.
    // The real offscreen document must keep capture and its session alive.
    const beforeWorkerStop = await panel.evaluate(() =>
      chrome.runtime.sendMessage({ target: 'offscreen', type: 'snapshot' }),
    );
    const bytesBeforeWorkerStop = bytes;
    await worker.evaluate(() => {
      (globalThis as any).__captureTestWorkerMarker = true;
    });
    const workerTargets = await browserCdp.send('Target.getTargets');
    const workerTarget = workerTargets.targetInfos.find(
      (target) => target.type === 'service_worker' && target.url.startsWith(origin),
    );
    expect(workerTarget).toBeDefined();
    await browserCdp.send('Target.closeTarget', { targetId: workerTarget!.targetId });
    // Playwright preserves its Worker wrapper across MV3 restarts. A volatile
    // global proves the JS worker itself restarted, unlike a wrapper close event.
    await expect
      .poll(async () => {
        try {
          return await worker.evaluate(
            () => (globalThis as any).__captureTestWorkerMarker === undefined,
          );
        } catch (error) {
          if ((error as Error).message.includes('Service worker restarted')) return false;
          throw error;
        }
      })
      .toBe(true);
    await expect
      .poll(() => bytes, { timeout: 15000 })
      .toBeGreaterThan(bytesBeforeWorkerStop + 9600);
    const afterWorkerStop = await panel.evaluate(() =>
      chrome.runtime.sendMessage({ target: 'offscreen', type: 'snapshot' }),
    );
    expect(afterWorkerStop.sessionId).toBe(beforeWorkerStop.sessionId);
    expect(afterWorkerStop.active).toBe(true);
    const samples: {
      elapsedSeconds: number;
      bytes: number;
      commits: number;
      transcriptChars: number;
      historyChars: number;
    }[] = [];
    soakMode = soakSeconds > 0;
    const soakStart = performance.now();
    let previousBytes = bytes;
    // Audio is VAD-gated: a natural pause can legitimately send nothing for one
    // 10 s interval. A stall is no progress for 30 s, matching the transcriber limit.
    let lastAudioProgressAt = performance.now();
    while (performance.now() - soakStart < soakSeconds * 1000) {
      await new Promise((resolve) => setTimeout(resolve, 10000));
      const snapshot = await panel.evaluate(() =>
        chrome.runtime.sendMessage({ target: 'offscreen', type: 'snapshot' }),
      );
      expect(snapshot.active).toBe(true);
      expect(snapshot.status).toBe('Listening');
      expect(bytes).toBeGreaterThanOrEqual(previousBytes);
      if (bytes > previousBytes) lastAudioProgressAt = performance.now();
      expect(performance.now() - lastAudioProgressAt).toBeLessThan(30000);
      // 24k mono PCM16 cannot produce more than 48k bytes per second,
      // allowing scheduler jitter and the bounded speech preroll.
      expect(bytes - previousBytes).toBeLessThan(600000);
      previousBytes = bytes;
      const transcriptChars = snapshot.segments.reduce(
        (n: number, s: { text: string }) => n + s.text.length,
        0,
      );
      expect(transcriptChars).toBeLessThanOrEqual(12000);
      expect(snapshot.suggestions.length).toBeLessThanOrEqual(3);
      const historyChars = (snapshot.transcriptHistory ?? []).reduce(
        (n: number, s: { text: string }) => n + s.text.length,
        0,
      );
      expect(historyChars).toBeLessThanOrEqual(500000);
      if (performance.now() - soakStart > 400000)
        expect(historyChars).toBeGreaterThan(transcriptChars);
      const sample = {
        elapsedSeconds: Math.round((performance.now() - soakStart) / 1000),
        bytes,
        commits,
        transcriptChars,
        historyChars,
      };
      samples.push(sample);
      if (samples.length % 6 === 0) console.log(JSON.stringify({ soak: sample }));
    }
    const active = await worker.evaluate(
      () =>
        new Promise<chrome.tabCapture.CaptureInfo[]>((resolve) =>
          chrome.tabCapture.getCapturedTabs(resolve),
        ),
    );
    expect(active.some((c) => c.status === 'active')).toBe(true);
    await Promise.all(soakTasks);
    if (soakSeconds) {
      await expect.poll(() => soakReplies.length).toBe(soakQuestionCount);
      expect(soakReplies).toEqual(
        Array.from({ length: soakQuestionCount }, (_, i) => soakQuestions[i % 45]),
      );
      if (soakSeconds >= 420) expect(soakQuestionCount).toBeGreaterThanOrEqual(45);
    }
    const before = bytes;
    const stopStarted = performance.now();
    await panel.evaluate(() => chrome.runtime.sendMessage({ target: 'offscreen', type: 'stop' }));
    await expect
      .poll(async () =>
        worker.evaluate(async () =>
          (
            await new Promise<chrome.tabCapture.CaptureInfo[]>((resolve) =>
              chrome.tabCapture.getCapturedTabs(resolve),
            )
          ).some((c) => c.status === 'active'),
        ),
      )
      .toBe(false);
    const stopped = await panel.evaluate(() =>
      chrome.runtime.sendMessage({ target: 'offscreen', type: 'snapshot' }),
    );
    const stopMs = performance.now() - stopStarted;
    expect(stopMs).toBeLessThan(1000);
    expect(stopped.active).toBe(false);
    expect(stopped.segments).toEqual([]);
    expect(stopped.transcriptHistory).toEqual([]);
    const log = await panel.evaluate(() =>
      chrome.runtime.sendMessage({ target: 'offscreen', type: 'test.export' }),
    );
    expect(log.endedAt).toBeGreaterThan(log.startedAt);
    expect(log.events.some((e: { kind: string }) => e.kind === 'quick.visible')).toBe(true);
    const storage = await panel.evaluate(() => chrome.storage.local.get(null));
    expect(JSON.stringify(storage)).not.toContain('quick.visible');
    await panel.evaluate(() =>
      chrome.runtime.sendMessage({ target: 'offscreen', type: 'test.clear' }),
    );
    expect(
      await panel.evaluate(() =>
        chrome.runtime.sendMessage({ target: 'offscreen', type: 'test.export' }),
      ),
    ).toBeNull();
    await expect(meet.locator('#noclue-cue .answer')).toHaveText('Your next cue will appear here.');
    if (soakSeconds) {
      // The list reporter does not persist body-only attachments. Keep a file
      // as well so passing runs retain all measurements, including Stop.
      await mkdir(testInfo.outputDir, { recursive: true });
      const path = testInfo.outputPath('capture-soak.json');
      await writeFile(
        path,
        JSON.stringify(
          {
            requestedSeconds: soakSeconds,
            soakQuestionsProcessed: soakQuestionCount,
            soakAnswersGenerated: soakReplies.length,
            complete45QuestionCycles: Math.floor(soakQuestionCount / 45),
            scenario: {
              project: 30,
              general: 5,
              personal: 5,
              repeated: 5,
              technicalTopicSwitches: 5,
            },
            testPort,
            samples,
            capturedBytes: before,
            commits,
            stopMs: Math.round(stopMs),
            tracksReleased: true,
            transcriptCleared: true,
            scope:
              'Real Chrome tab capture; synthetic speech; mocked AI; physical microphone denied',
          },
          null,
          2,
        ),
      );
      await testInfo.attach('capture-soak', { path, contentType: 'application/json' });
    }
    console.log(
      JSON.stringify({
        test: 'real Chrome capture; synthetic page/audio; mocked AI',
        capturedBytes: before,
        commits,
        nonzeroPCM: true,
        tracksReleased: true,
        stopMs: Math.round(stopMs),
      }),
    );
  } catch (error) {
    const page = context.pages().find((p) => p.url().endsWith('/sidepanel.html'));
    if (page) {
      const diagnostic = await page
        .evaluate(async () => ({
          state: await chrome.runtime.sendMessage({ target: 'offscreen', type: 'snapshot' }),
          log: await chrome.runtime.sendMessage({ target: 'offscreen', type: 'test.export' }),
        }))
        .catch(() => null);
      await mkdir(testInfo.outputDir, { recursive: true });
      await writeFile(
        testInfo.outputPath('capture-failure.json'),
        JSON.stringify(diagnostic, null, 2),
      );
      console.log(
        JSON.stringify({
          captureFailure: diagnostic?.state?.status,
          diagnosticFile: testInfo.outputPath('capture-failure.json'),
        }),
      );
    }
    throw error;
  } finally {
    await context.close();
    await app?.close();
    await rm(profile, { recursive: true, force: true });
  }
});
