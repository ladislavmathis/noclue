import { isolatedExtension } from './helpers/extension';
import { test, expect, chromium, type BrowserContext } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { initialState } from '@noclue/shared';
let context: BrowserContext, profile: string, origin: string;
test.beforeAll(async () => {
  profile = await mkdtemp(join(tmpdir(), 'noclue-browser-'));
  const extension = await isolatedExtension(profile);
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    viewport: { width: 420, height: 950 },
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
    ],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  origin = `chrome-extension://${new URL(worker.url()).host}`;
});
test.afterAll(async () => {
  await context?.close();
  if (profile) await rm(profile, { recursive: true, force: true });
});
test('live transcript shows older source-labelled history and can be resized without changing AI context', async () => {
  const page = await context.newPage();
  try {
    await page.goto(`${origin}/sidepanel.html`);
    await expect(page.getByText('noclue by ignition', { exact: false })).toBeVisible();
    const history = Array.from({ length: 25 }, (_, i) => ({
      id: `history-${i}`,
      sequence: i,
      text: `Meeting statement ${i}. This is a synthetic transcript fixture.`,
      at: Date.now() - (25 - i) * 30000,
      final: true,
    }));
    const state = {
      ...initialState(),
      active: true,
      status: 'Listening' as const,
      segments: history.slice(-5),
      transcriptHistory: history,
    };
    const worker = context.serviceWorkers()[0];
    await worker.evaluate(
      (state) => chrome.runtime.sendMessage({ target: 'panel', type: 'state', state }),
      state,
    );
    await page.locator('summary').filter({ hasText: 'Live transcript' }).click();
    const transcript = page.locator('.transcript');
    await expect(transcript).toContainText('Meeting statement 0.');
    await expect(transcript).toContainText('Meeting statement 24.');
    await expect(transcript.locator('small')).toHaveCount(25);
    await expect(transcript.locator('small').first()).toContainText('Meeting audio');
    await transcript.scrollIntoViewIfNeeded();
    const before = await transcript.boundingBox();
    await page.mouse.move(before!.x + before!.width - 3, before!.y + before!.height - 3);
    await page.mouse.down();
    await page.mouse.move(before!.x + before!.width - 3, before!.y + before!.height + 90, {
      steps: 5,
    });
    await page.mouse.up();
    await expect
      .poll(async () => (await transcript.boundingBox())!.height)
      .toBeGreaterThan(before!.height + 50);
  } finally {
    await page.close();
  }
});
test('loads a real MV3 panel, validates context and persists only explicit settings', async () => {
  const page = await context.newPage(),
    errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${origin}/sidepanel.html`);
  await expect(page.getByRole('heading', { name: 'Ready when you are.' })).toBeVisible();
  await page.getByLabel('Project name').fill('Fictional test project');
  await page.getByLabel('Project context').fill('The pilot scope is not confirmed.');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByRole('status')).toHaveText('Saved on this device.');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Fictional test project' })).toBeVisible();
  await page.getByRole('button', { name: /^Settings/ }).click();
  await page.getByLabel('Project context').fill('x'.repeat(20001));
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByRole('status')).toContainText('20,000');
  await page.reload();
  await page.getByRole('button', { name: /^Settings/ }).click();
  await expect(page.getByLabel('Project context')).toHaveValue('The pilot scope is not confirmed.');
  await page.getByRole('button', { name: /^Settings/ }).click();
  await page.screenshot({ path: 'test-results/panel.png', fullPage: true });
  expect(errors).toEqual([]);
  await page.close();
});
test('runs bundled VAD/WASM on a fake microphone without network audio', async () => {
  const page = await context.newPage(),
    errors: string[] = [],
    requests: string[] = [],
    sockets: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => requests.push(r.url()));
  page.on('websocket', (ws) => sockets.push(ws.url()));
  await page.goto(`${origin}/setup.html#microphone`);
  await page.getByRole('button', { name: 'Allow microphone & test' }).click();
  await expect(page.getByRole('status')).toContainText('Speak normally.', { timeout: 25000 });
  await expect(page.getByRole('button', { name: 'Stop test' })).toBeVisible();
  expect(requests.some((url) => url.endsWith('silero_vad_v5.onnx'))).toBe(true);
  expect(requests.some((url) => url.endsWith('.wasm'))).toBe(true);
  expect(requests.every((url) => url.startsWith(origin))).toBe(true);
  expect(sockets).toEqual([]);
  await page.getByRole('button', { name: 'Stop test' }).click();
  await expect(page.getByRole('button', { name: 'Allow microphone & test' })).toBeVisible();
  expect(errors).toEqual([]);
  await page.close();
});
test('executes the built PCM AudioWorklet inside extension CSP', async () => {
  const page = await context.newPage();
  await page.goto(`${origin}/setup.html`);
  const length = await page.evaluate(async () => {
    const audio = new AudioContext({ sampleRate: 44100 });
    await audio.resume();
    await audio.audioWorklet.addModule(chrome.runtime.getURL('pcm-worklet.js'));
    const oscillator = new OscillatorNode(audio, { frequency: 440 }),
      worklet = new AudioWorkletNode(audio, 'ignition-pcm'),
      gain = audio.createGain();
    gain.gain.value = 0;
    oscillator.connect(worklet).connect(gain).connect(audio.destination);
    const received = new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('No PCM')), 5000);
      worklet.port.onmessage = (event) => {
        clearTimeout(timer);
        resolve(event.data.byteLength);
      };
    });
    oscillator.start();
    const bytes = await received;
    oscillator.stop();
    await audio.close();
    return bytes;
  });
  expect(length).toBe(4800);
  await page.close();
});

test('offscreen session survives panel closure, supports manual mode and clears after Stop (synthetic input, mocked AI)', async () => {
  const { buildApp } = await import('./helpers/hub-server');
  const { factsFromContext } = await import('../packages/shared/src/index');
  const project = {
    name: 'Fictional lifecycle fixture',
    role: 'Lead',
    goal: 'Clarify scope',
    context: 'A pilot is planned but not yet completed.',
    keywords: [],
  };
  let providerClosed = false;
  let requests = 0,
    completed = 0;
  let finishReply: (() => void) | undefined;
  const app = await buildApp({
    configured: true,
    recommend: async () => {
      requests++;
      if (requests === 2)
        await new Promise<void>((resolve) => {
          finishReply = resolve;
        });
      completed++;
      return {
        action: 'suggest',
        responseType: 'answer' as const,
        category: 'question',
        triggerSegmentIds: ['fixture-segment'],
        topicKey: 'pilot-scope',
        recommendation: 'Clarify the pilot scope.',
        suggestedResponse: 'We have a pilot planned. Could we agree on the scope together?',
        groundedFactIds: [factsFromContext(project.context)[0].id],
        missingInformation: [],
      };
    },
    transcriber: (_project, onSegment) => ({
      connect: async () => {
        setTimeout(
          () =>
            onSegment({
              id: 'fixture-segment',
              sequence: 0,
              text: 'What should we do next about the pilot?',
              at: Date.now(),
              final: true,
            }),
          100,
        );
      },
      append: () => {},
      commit: () => {},
      close: () => {
        providerClosed = true;
      },
    }),
  });
  await app.listen({ host: '127.0.0.1', port: 4327 });
  const offscreen = await context.newPage();
  await offscreen.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      if ((constraints?.audio as any)?.mandatory?.chromeMediaSource === 'tab')
        return original({ audio: true });
      throw new DOMException('Synthetic missing microphone', 'NotAllowedError');
    };
  });
  try {
    await offscreen.goto(`${origin}/offscreen.html`);
    let panel = await context.newPage();
    await panel.goto(`${origin}/sidepanel.html`);
    const result = await panel.evaluate(
      async ({ project }) =>
        chrome.runtime.sendMessage({
          target: 'offscreen',
          type: 'start',
          settings: { project, openaiKey: 'sk-test-lifecycle-not-a-real-key', microphoneId: '' },
          streamId: 'synthetic-test-only',
          tabId: 321,
        }),
      { project },
    );
    expect(result.ok).toBe(true);
    await expect(panel.getByText('Listening', { exact: true })).toBeVisible({ timeout: 15000 });
    await panel.close();
    panel = await context.newPage();
    await panel.goto(`${origin}/sidepanel.html`);
    await expect(panel.getByText('Listening', { exact: true })).toBeVisible();
    await expect(panel.getByText('Mic unavailable', { exact: true })).toBeVisible();
    await expect
      .poll(async () =>
        panel.evaluate(async () => {
          const state = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'snapshot' });
          return state.segments.length;
        }),
      )
      .toBe(1);
    await panel.getByRole('button', { name: 'Answer Now' }).click();
    await expect(
      panel.getByText('We have a pilot planned. Could we agree on the scope together?'),
    ).toBeVisible();
    await panel.screenshot({ path: 'test-results/recommendation.png', fullPage: true });
    await expect(panel.getByRole('button', { name: /^Settings/ })).toBeDisabled();
    // Capture the copy request without changing the user's OS clipboard.
    await panel.evaluate(() =>
      Object.defineProperty(navigator.clipboard, 'writeText', {
        configurable: true,
        value: async (text: string) => {
          document.documentElement.dataset.copied = text;
        },
      }),
    );
    await panel.getByRole('button', { name: 'Copy response' }).click();
    await expect(panel.locator('html')).toHaveAttribute(
      'data-copied',
      'We have a pilot planned. Could we agree on the scope together?',
    );
    await expect(panel.getByRole('status')).toHaveText('Response copied.');
    await panel.evaluate(() =>
      Object.defineProperty(navigator.clipboard, 'writeText', {
        configurable: true,
        value: async () => {
          throw new Error('Clipboard unavailable');
        },
      }),
    );
    await panel.getByRole('button', { name: 'Copy response' }).click();
    await expect(panel.getByRole('status')).toContainText('Select and copy the response.');
    await panel.getByRole('button', { name: 'Dismiss', exact: true }).click();
    await expect(
      panel.getByText('We have a pilot planned. Could we agree on the scope together?'),
    ).toBeHidden();
    await panel.getByRole('button', { name: 'Answer Now' }).click();
    await expect(panel.getByRole('button', { name: 'Thinking…', exact: true })).toBeDisabled();

    await panel.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(panel.getByText('Stopped', { exact: true })).toBeVisible();
    const stopped = await panel.evaluate(async () =>
      chrome.runtime.sendMessage({ target: 'offscreen', type: 'snapshot' }),
    );
    expect(stopped.segments).toEqual([]);
    expect(stopped.suggestions).toEqual([]);
    expect(stopped.active).toBe(false);
    await expect.poll(() => providerClosed).toBe(true);
    finishReply?.();
    await expect.poll(() => completed).toBe(2);
    await expect(
      panel.getByText('We have a pilot planned. Could we agree on the scope together?'),
    ).toBeHidden();
    await panel.close();
  } finally {
    await offscreen.close();
    await app.close();
  }
});

test('keeps the last answer as the cue through a new question or retry until a newer draft replaces it', async () => {
  const { mountCue } = await import('../apps/extension/src/background/overlay');
  const page = await context.newPage();
  try {
    await page.goto(`${origin}/sidepanel.html`);
    await page.evaluate(mountCue);
    const state = {
      ...initialState(),
      active: true,
      status: 'Listening' as const,
      question: {
        id: 'q1',
        revision: 1,
        text: 'What does the compiler do?',
        segmentIds: ['s1'],
        state: 'ANSWERING' as const,
      },
      currentRequestId: 'r1',
      suggestions: [
        {
          action: 'suggest' as const,
          responseType: 'answer' as const,
          category: 'question' as const,
          topicKey: 'compiler',
          groundedFactIds: [],
          triggerSegmentIds: ['s1'],
          missingInformation: [],
          recommendation: 'Explain the proposed role.',
          suggestedResponse: 'It plans verification.',
          requestId: 'r1',
          questionId: 'q1',
          revision: 1,
          question: 'What does the compiler do?',
          at: Date.now(),
          mode: 'manual' as const,
        },
      ],
    };
    const worker = context.serviceWorkers()[0];
    const send = async () => {
      await worker.evaluate(
        (state) => chrome.runtime.sendMessage({ target: 'panel', type: 'state', state }),
        state,
      );
      await worker.evaluate((state) => chrome.runtime.sendMessage({ target: 'cue', state }), state);
    };
    await send();
    await expect(page.locator('#noclue-cue .answer')).toHaveText('It plans verification.');
    state.currentRequestId = 'r2';
    state.generating = true;
    await send();
    await expect(page.locator('#noclue-cue .answer')).toHaveText('It plans verification.');
    state.question = { ...state.question, id: 'q2', text: 'How is uncertainty shown?' };
    state.currentRequestId = 'r3';
    await send();
    await expect(page.locator('#noclue-cue .question')).toHaveText('What does the compiler do?');
    await expect(page.locator('#noclue-cue .answer')).toHaveText('It plans verification.');
    await expect(page.locator('#noclue-cue #copy')).toBeEnabled();
    await expect(page.locator('.suggestion:not(.previous) .card-top')).toContainText('Answer Now');
    Object.assign(state, {
      preview: {
        requestId: 'r3',
        questionId: 'q2',
        revision: 1,
        suggestedResponse: 'Confidence is labelled.',
        recommendation: '',
        responseType: 'answer' as const,
      },
    });
    await send();
    await expect(page.locator('#noclue-cue .answer')).toHaveText('Confidence is labelled.');
    await expect(page.locator('#noclue-cue .question')).toHaveText('How is uncertainty shown?');
    await expect(page.locator('#noclue-cue #copy')).toBeDisabled();
    await expect(page.locator('.suggestion.previous .card-top')).toContainText('Earlier');
    Object.assign(state, { preview: undefined, generating: false, cueDismissed: true });
    await send();
    await expect(page.locator('#noclue-cue .answer')).toHaveText('Listening for your next cue…');
  } finally {
    await page.close();
  }
});

test('lists older answers under the newest cue and keeps them after Dismiss', async () => {
  const { mountCue } = await import('../apps/extension/src/background/overlay');
  const page = await context.newPage();
  try {
    await page.goto(`${origin}/sidepanel.html`);
    await page.evaluate(mountCue);
    const suggestion = (n: number, question: string, suggestedResponse: string) => ({
      action: 'suggest' as const,
      responseType: 'answer' as const,
      category: 'question' as const,
      topicKey: `topic-${n}`,
      groundedFactIds: [],
      triggerSegmentIds: [`s${n}`],
      missingInformation: [],
      recommendation: `Recommendation ${n}.`,
      suggestedResponse,
      requestId: `r${n}`,
      questionId: `q${n}`,
      revision: 1,
      question,
      at: Date.now() - (3 - n) * 1000,
      mode: 'manual' as const,
    });
    const r1 = suggestion(1, 'What does the compiler do?', 'It plans verification.');
    const r2 = suggestion(2, 'How is uncertainty shown?', 'Confidence is labelled.');
    const r3 = suggestion(3, 'When does the pilot start?', 'The pilot starts in May.');
    const state = {
      ...initialState(),
      active: true,
      status: 'Listening' as const,
      question: {
        id: 'q3',
        revision: 1,
        text: 'When does the pilot start?',
        segmentIds: ['s3'],
        state: 'ANSWERING' as const,
      },
      currentRequestId: 'r3',
      suggestions: [r3, r2, r1],
    };
    const worker = context.serviceWorkers()[0];
    const send = async () => {
      await worker.evaluate(
        (state) => chrome.runtime.sendMessage({ target: 'panel', type: 'state', state }),
        state,
      );
      await worker.evaluate((state) => chrome.runtime.sendMessage({ target: 'cue', state }), state);
    };
    await send();
    const cue = page.locator('#noclue-cue');
    await expect(cue.locator('.answer')).toHaveText('The pilot starts in May.');
    await expect(cue.locator('.answer')).toHaveCount(1);
    await expect(cue.locator('.question')).toHaveCount(1);
    const items = cue.locator('.history li');
    await expect(items).toHaveCount(2);
    await expect(items.nth(0).locator('.h-question')).toHaveText('How is uncertainty shown?');
    await expect(items.nth(0).locator('.h-answer')).toHaveText('Confidence is labelled.');
    await expect(items.nth(1).locator('.h-question')).toHaveText('What does the compiler do?');
    await expect(items.nth(1).locator('.h-answer')).toHaveText('It plans verification.');
    await expect(cue.locator('.history .h-copy')).toHaveCount(2);
    Object.assign(state, { cueDismissed: true, suggestions: [r2, r1] });
    await send();
    await expect(cue.locator('.answer')).toHaveText('Listening for your next cue…');
    await expect(items).toHaveCount(2);
    await expect(items.nth(0).locator('.h-answer')).toHaveText('Confidence is labelled.');
    await expect(items.nth(1).locator('.h-answer')).toHaveText('It plans verification.');
    await expect(cue.locator('#copy')).toBeDisabled();
    Object.assign(state, { cueDismissed: false, suggestions: [r3] });
    await send();
    await expect(cue.locator('.answer')).toHaveText('The pilot starts in May.');
    await expect(cue.locator('.history')).toBeHidden();
  } finally {
    await page.close();
  }
});

test('shows an unverified preview as a marked draft in panel and cue, then replaces it with the checked answer', async () => {
  const { mountCue } = await import('../apps/extension/src/background/overlay');
  const page = await context.newPage();
  try {
    await page.goto(`${origin}/sidepanel.html`);
    await page.evaluate(mountCue);
    const question = {
      id: 'q1',
      revision: 1,
      text: 'When does the pilot start?',
      segmentIds: ['s1'],
      state: 'QUESTION_COMPLETE' as const,
    };
    const state: any = {
      ...initialState(),
      active: true,
      status: 'Listening',
      question,
      currentRequestId: 'r1',
      generating: true,
      generatingMode: 'manual',
      preview: {
        requestId: 'r1',
        questionId: 'q1',
        revision: 1,
        suggestedResponse: 'The pilot is planned for spring.',
        recommendation: 'State the plan.',
        responseType: 'answer',
      },
    };
    const worker = context.serviceWorkers()[0];
    const send = async () => {
      await worker.evaluate(
        (state) => chrome.runtime.sendMessage({ target: 'panel', type: 'state', state }),
        state,
      );
      await worker.evaluate((state) => chrome.runtime.sendMessage({ target: 'cue', state }), state);
    };
    await send();
    await expect(page.getByTestId('answer-preview')).toContainText('Checking facts…');
    await expect(page.getByTestId('answer-preview')).toContainText(
      'The pilot is planned for spring.',
    );
    await expect(page.locator('#noclue-cue .answer')).toHaveText(
      'The pilot is planned for spring.',
    );
    await expect(page.locator('#noclue-cue .answer')).toHaveClass(/unverified/);
    await expect(page.locator('#noclue-cue .status')).toContainText('Checking facts');
    await expect(page.locator('#noclue-cue #copy')).toBeDisabled();
    // A preview from another request is never shown.
    state.currentRequestId = 'r2';
    await send();
    await expect(page.getByTestId('answer-preview')).toHaveCount(0);
    // The checked answer replaces the draft.
    state.currentRequestId = 'r1';
    state.generating = false;
    state.preview = undefined;
    state.suggestions = [
      {
        action: 'suggest',
        responseType: 'answer',
        category: 'question',
        topicKey: 'pilot',
        groundedFactIds: [],
        triggerSegmentIds: ['s1'],
        missingInformation: [],
        recommendation: 'State the plan.',
        suggestedResponse: 'The pilot is proposed for spring; the date is not confirmed.',
        requestId: 'r1',
        questionId: 'q1',
        revision: 1,
        question: question.text,
        at: Date.now(),
        mode: 'manual',
      },
    ];
    await send();
    await expect(page.getByTestId('answer-preview')).toHaveCount(0);
    await expect(page.locator('#noclue-cue .answer')).toHaveText(
      'The pilot is proposed for spring; the date is not confirmed.',
    );
    await expect(page.locator('#noclue-cue .answer')).not.toHaveClass(/unverified/);
  } finally {
    await page.close();
  }
});

test('cue hides itself while the page shares a tab or the screen, and the share hook only observes', async () => {
  const { mountCue } = await import('../apps/extension/src/background/overlay');
  const { hookDisplayMedia } = await import('../apps/extension/src/background/share-hook');
  const page = await context.newPage();
  try {
    await page.goto(`${origin}/sidepanel.html`);
    await page.evaluate(() => chrome.storage.local.remove('cueLayout'));
    // Stand-in for the browser's share picker: returns a canvas stream whose surface the test picks.
    await page.evaluate(() => {
      const w = window as any;
      w.__surface = 'browser';
      navigator.mediaDevices.getDisplayMedia = async () => {
        const canvas = document.createElement('canvas');
        const stream = canvas.captureStream();
        const track = stream.getVideoTracks()[0];
        const surface = w.__surface;
        track.getSettings = () => ({ displaySurface: surface }) as MediaTrackSettings;
        w.__lastStream = stream;
        return stream;
      };
    });
    await page.evaluate(hookDisplayMedia);
    const wrapped = await page.evaluate(() => String(navigator.mediaDevices.getDisplayMedia));
    await page.evaluate(hookDisplayMedia);
    expect(await page.evaluate(() => String(navigator.mediaDevices.getDisplayMedia))).toBe(wrapped);
    await page.evaluate(mountCue);
    const host = page.locator('#noclue-cue');
    await expect(host).toBeVisible();
    await expect(host.locator('.privacy')).toContainText('Pop out');

    // A tab share started from the page hides the in-page cue until the app stops the track.
    const same = await page.evaluate(async () => {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      (window as any).__track = stream.getVideoTracks()[0];
      return stream === (window as any).__lastStream;
    });
    expect(same).toBe(true);
    await expect(host).toHaveCSS('visibility', 'hidden');
    await page.evaluate(() => (window as any).__track.stop());
    await expect(host).toHaveCSS('visibility', 'visible');

    // A whole-screen share hides it too; Chrome's "Stop sharing" fires 'ended'.
    await page.evaluate(async () => {
      (window as any).__surface = 'monitor';
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      (window as any).__track = stream.getVideoTracks()[0];
    });
    await expect(host).toHaveCSS('visibility', 'hidden');
    await page.evaluate(() => (window as any).__track.dispatchEvent(new Event('ended')));
    await expect(host).toHaveCSS('visibility', 'visible');

    // Unrelated events with the same name are ignored.
    await page.evaluate(() =>
      document.dispatchEvent(new CustomEvent('noclue:share', { detail: 'not json' })),
    );
    await expect(host).toHaveCSS('visibility', 'visible');
  } finally {
    await page.close();
  }
});

test('cue pops out into a Picture-in-Picture window that only a whole-screen share hides', async () => {
  const { mountCue } = await import('../apps/extension/src/background/overlay');
  const page = await context.newPage();
  try {
    await page.goto(`${origin}/sidepanel.html`);
    await page.evaluate(() => chrome.storage.local.remove('cueLayout'));
    await page.evaluate(mountCue);
    const share = (id: number, active: boolean, surface: string) =>
      page.evaluate(
        (detail) =>
          document.dispatchEvent(
            new CustomEvent('noclue:share', { detail: JSON.stringify(detail) }),
          ),
        { id, active, surface },
      );
    const opened = context.waitForEvent('page');
    await page.locator('#noclue-cue').getByRole('button', { name: 'Pop out cue window' }).click();
    const pip = await opened;
    await expect(page.locator('#noclue-cue')).toHaveCount(0);
    const host = pip.locator('#noclue-cue');
    await expect(host).toHaveCount(1);
    // Showing the cue again focuses the open window instead of creating a second cue.
    await page.evaluate(mountCue);
    await expect(page.locator('#noclue-cue')).toHaveCount(0);
    // Tab and window shares do not capture the separate window.
    await share(1, true, 'browser');
    await share(2, true, 'window');
    await expect(host).toHaveCSS('visibility', 'visible');
    await share(3, true, 'monitor');
    await expect(host).toHaveCSS('visibility', 'hidden');
    await share(3, false, 'monitor');
    await expect(host).toHaveCSS('visibility', 'visible');
    // Back in the page, the tab and window shares still running hide it there.
    await host.getByRole('button', { name: 'Return cue window to the meeting page' }).click();
    await expect(page.locator('#noclue-cue')).toHaveCSS('visibility', 'hidden');
    await share(1, false, 'browser');
    await share(2, false, 'window');
    await expect(page.locator('#noclue-cue')).toHaveCSS('visibility', 'visible');
    expect(
      await page.evaluate(
        async () => (await chrome.storage.local.get('cueLayout')).cueLayout?.popout,
      ),
    ).toBe(true);
    // The next cue highlights Pop out, since Chrome needs a click to open the window.
    await page.locator('#noclue-cue').getByRole('button', { name: 'Hide cue' }).click();
    await page.evaluate(mountCue);
    await expect(page.locator('#noclue-cue #pop')).toHaveClass(/suggest/);
  } finally {
    await page.close();
  }
});
