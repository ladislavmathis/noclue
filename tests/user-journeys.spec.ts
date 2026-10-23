import { isolatedExtension, mountTestCue } from './helpers/extension';
import { APP_VERSION, PROTOCOL_VERSION } from '../packages/shared/src/index';
import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
let context: BrowserContext, profile: string, origin: string;
const saved = {
  openaiKey: 'sk-test-user-journeys-not-a-real-key',
  anthropicKey: '',
  answerProvider: 'openai',
  answerModel: '',
  consentAt: 1,
  microphoneId: '',
  project: {
    name: 'Fictional project',
    role: 'Lead',
    goal: 'Agree a pilot',
    context: 'The pilot has not been completed.',
    keywords: [],
  },
};
test.beforeAll(async () => {
  profile = await mkdtemp(join(tmpdir(), 'noclue-user-tests-'));
  const extension = await isolatedExtension(profile);
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    viewport: { width: 360, height: 800 },
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
test.beforeEach(async () => {
  const page = await context.newPage();
  await page.goto(`${origin}/setup.html`);
  await page.evaluate(() => chrome.storage.local.clear());
  await page.close();
});
test.afterEach(async () => {
  for (const page of context.pages()) await page.close();
});
test('response controls persist and keep microphone privacy unchanged', async () => {
  const page = await panel();
  await expect(page.getByLabel('Show first draft while facts are checked')).not.toBeChecked();
  await page.getByLabel('Show first draft while facts are checked').check();
  await page.getByLabel('Response style', { exact: true }).selectOption('executive');
  await page.getByLabel('Meeting language', { exact: true }).selectOption('sk');
  await page.getByLabel('Response length', { exact: true }).selectOption('detailed');
  await page.getByLabel('Stick to my knowledge').uncheck();
  await page.getByRole('slider', { name: 'Silence threshold', exact: true }).fill('1500');
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: /^Settings/ }).click();
  await expect(page.getByLabel('Show first draft while facts are checked')).toBeChecked();
  await expect(page.getByLabel('Response style', { exact: true })).toHaveValue('executive');
  await expect(page.getByLabel('Meeting language', { exact: true })).toHaveValue('sk');
  expect((await stored(page)).project.preferences.language).toBe('sk');
  await expect(page.getByLabel('Response length', { exact: true })).toHaveValue('detailed');
  await expect(page.getByLabel('Stick to my knowledge')).not.toBeChecked();
  await expect(page.getByRole('slider', { name: 'Silence threshold', exact: true })).toHaveValue(
    '1500',
  );
  expect((await stored(page)).microphoneId).toBe('');
});
async function panel(prefilled = true) {
  const page = await context.newPage();
  await page.goto(`${origin}/sidepanel.html`);
  if (prefilled) {
    await page.evaluate((s) => chrome.storage.local.set({ settings: s }), saved);
    await page.reload();
    await page.getByRole('button', { name: /^Settings/ }).click();
  }
  return page;
}
async function mockDevices(page: Page) {
  await page.addInitScript(() => {
    navigator.mediaDevices.enumerateDevices = async () => [
      {
        deviceId: 'user-test-headset',
        kind: 'audioinput',
        label: 'Simulated headset',
        groupId: 'test',
        toJSON: () => ({}),
      } as MediaDeviceInfo,
    ];
  });
}
async function stored(page: Page) {
  return page.evaluate(async () => (await chrome.storage.local.get('settings')).settings);
}

test('new user sees the welcome card, a missing key and disabled Start', async () => {
  const page = await panel(false);
  await expect(page.getByRole('heading', { name: 'Welcome to noclue' })).toBeVisible();
  await expect(page.getByText('API key missing', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start Listening' })).toBeDisabled();
  await expect(page.getByLabel('Project name')).toBeVisible();
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByRole('status')).toContainText('Project name');
  // API settings are saved even without a project; the empty project is not.
  expect((await stored(page)).project.name).toBe('');
});
test('setup guide saves keys, microphone step and the data notice before Start', async () => {
  const page = await context.newPage();
  await mockDevices(page);
  await page.goto(`${origin}/setup.html`);
  await expect(page.getByRole('heading', { name: 'Connect your AI' })).toBeVisible();
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page.getByRole('status')).toContainText('Add your OpenAI API key');
  await page.getByLabel('OpenAI API key').fill('  sk-test-guide-not-a-real-key \n');
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page.getByRole('heading', { name: 'Check your microphone' })).toBeVisible();
  expect((await stored(page)).openaiKey).toBe('sk-test-guide-not-a-real-key');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Where your data goes' })).toBeVisible();
  await page.getByRole('button', { name: 'Finish setup' }).click();
  await expect(page.getByRole('status')).toContainText('confirm');
  expect((await stored(page)).consentAt).toBeUndefined();
  await page.getByLabel('I have read this and will use noclue responsibly.').check();
  await page.getByRole('button', { name: 'Finish setup' }).click();
  await expect(page.getByRole('heading', { name: 'You are ready' })).toBeVisible();
  expect((await stored(page)).consentAt).toBeGreaterThan(0);
  const sidepanel = await context.newPage();
  await sidepanel.goto(`${origin}/sidepanel.html`);
  await expect(sidepanel.getByRole('heading', { name: 'Welcome to noclue' })).toHaveCount(0);
  await expect(sidepanel.getByText('Answers by OpenAI', { exact: true })).toBeVisible();
});
test('imported UTF-8 project is a draft until Save and survives a reload after saving', async () => {
  const page = await panel();
  const text = 'Overené fakty:\n\nPilot ešte neprebehol. Žiadne potvrdené výsledky.';
  await page
    .getByLabel('Import .txt or .md')
    .setInputFiles({ name: 'project.md', mimeType: 'text/markdown', buffer: Buffer.from(text) });
  await expect(page.getByLabel('Project context')).toHaveValue(text);
  expect((await stored(page)).project.context).toBe(saved.project.context);
  await page.getByRole('button', { name: 'Save settings' }).click();
  await page.reload();
  await page.getByRole('button', { name: /^Settings/ }).click();
  await expect(page.getByLabel('Project context')).toHaveValue(text);
});
for (const specimen of [
  { name: 'project.pdf', buffer: Buffer.from('PDF'), message: 'Choose a .txt or .md file.' },
  {
    name: 'large.md',
    buffer: Buffer.from('x'.repeat(20001)),
    message: 'Context exceeds 20,000 characters.',
  },
  { name: 'invalid.txt', buffer: Buffer.from([0xc3, 0x28]), message: 'UTF-8' },
])
  test(`rejects ${specimen.name} without overwriting the current context`, async () => {
    const page = await panel();
    await page.getByLabel('Import .txt or .md').setInputFiles({
      name: specimen.name,
      mimeType: 'application/octet-stream',
      buffer: specimen.buffer,
    });
    await expect(page.getByRole('status')).toContainText(specimen.message);
    await expect(page.getByLabel('Project context')).toHaveValue(saved.project.context);
    expect((await stored(page)).project.context).toBe(saved.project.context);
  });
test('microphone setup must not erase an unsaved project draft in the panel', async () => {
  const page = await panel();
  await page.getByLabel('Project name').fill('Unsaved negotiation');
  await page.getByLabel('Project context').fill('Important new draft facts.');
  const opened = context.waitForEvent('page');
  await page.getByRole('button', { name: 'Set up microphone' }).click();
  const setup = await opened;
  await mockDevices(setup);
  // This test verifies settings preservation, not macOS device permissions.
  await setup.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () =>
      new AudioContext().createMediaStreamDestination().stream;
  });
  await setup.reload();
  await setup.getByRole('button', { name: 'Allow microphone & test' }).click();
  await expect(setup.getByRole('status')).toContainText('Speak normally.');
  await setup.getByRole('button', { name: 'Stop test' }).click();
  await setup.getByRole('combobox').selectOption('user-test-headset');
  await setup.getByRole('button', { name: 'Save microphone' }).click();
  await expect(setup.getByRole('status')).toContainText('Microphone saved.');
  await page.bringToFront();
  await expect(page.getByLabel('Project name')).toHaveValue('Unsaved negotiation');
  await expect(page.getByLabel('Project context')).toHaveValue('Important new draft facts.');
  expect((await stored(page)).project.context).toBe(saved.project.context);
});
test('permission denied gives a recoverable microphone error and enables retry', async () => {
  const page = await context.newPage();
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException('Permission denied', 'NotAllowedError');
    };
  });
  await page.goto(`${origin}/setup.html#microphone`);
  await page.getByRole('button', { name: 'Allow microphone & test' }).click();
  await expect(page.getByRole('status')).toContainText('Microphone access was blocked');
  await expect(page.getByRole('button', { name: 'Allow microphone & test' })).toBeEnabled();
});
test('saved microphone stays visibly selected when setup is reopened', async () => {
  const page = await context.newPage();
  await mockDevices(page);
  await page.goto(`${origin}/setup.html#microphone`);
  await page.getByRole('button', { name: 'Allow microphone & test' }).click();
  await expect(page.getByRole('status')).toContainText('Speak normally.');
  await page.getByRole('button', { name: 'Stop test' }).click();
  const option = await page.getByRole('combobox').locator('option').nth(1).getAttribute('value');
  expect(option).toBeTruthy();
  await page.getByRole('combobox').selectOption(option!);
  await page.getByRole('button', { name: 'Save microphone' }).click();
  await expect(page.getByRole('status')).toContainText('Microphone saved.');
  await page.reload();
  await expect(page.getByRole('combobox')).toHaveValue(option!);
  const label = await page.getByRole('combobox').locator('option:checked').textContent();
  expect(label?.trim()).toBeTruthy();
});
test('360px panel supports keyboard save and has no horizontal overflow', async () => {
  const page = await panel();
  await page.getByLabel('Project name').fill('Keyboard-only edit');
  await page.getByRole('button', { name: 'Save settings' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status')).toHaveText('Saved on this device.');
  expect((await stored(page)).project.name).toBe('Keyboard-only edit');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: 'test-results/user-panel-360.png', fullPage: true });
});

test('missing API key is visible and prevents Start', async () => {
  const page = await context.newPage();
  await page.goto(`${origin}/sidepanel.html`);
  await page.evaluate(
    (s) => chrome.storage.local.set({ settings: { ...s, openaiKey: '' } }),
    saved,
  );
  await page.reload();
  await expect(page.getByText('API key missing', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start Listening' })).toBeDisabled();
  await expect(page.getByRole('region', { name: 'Before your meeting' })).toContainText(
    'Add your OpenAI API key',
  );
});
test('Start from a non-Meet tab explains how to recover', async () => {
  const page = await panel();
  await expect(page.getByText('Answers by OpenAI', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Start Listening' }).click();
  await expect(page.getByRole('status')).toContainText(
    'Select your Google Meet or Microsoft Teams tab',
  );
  await expect(page.getByRole('button', { name: 'Start Listening' })).toBeEnabled();
});
test('project can be prepared before adding keys and survives reload', async () => {
  const page = await panel();
  await page.getByLabel('OpenAI API key').fill('');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await page.reload();
  expect((await stored(page)).project.name).toBe(saved.project.name);
  expect((await stored(page)).openaiKey).toBe('');
  await expect(page.getByRole('region', { name: 'Before your meeting' })).toBeVisible();
});
test('Anthropic answers need their own key; keys save explicitly and keep unsaved project edits', async () => {
  const page = await panel();
  await page.getByLabel('Project name').fill('Unsaved draft');
  await page.getByLabel('Anthropic (Claude)').check();
  await expect(page.getByText('API key missing', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Answer model')).toHaveValue('claude-opus-5-5');
  await page.getByLabel('Anthropic API key').fill('sk-proj-looks-like-openai-key-0000');
  await expect(
    page.getByText('This does not look like an Anthropic key', { exact: false }),
  ).toBeVisible();
  await page.getByLabel('Anthropic API key').fill('sk-ant-test-not-a-real-key-000000');
  await expect(page.getByText('Answers by Anthropic', { exact: true })).toBeVisible();
  expect((await stored(page)).answerProvider).toBe('openai');
  // A storage write from another page (microphone setup) must not discard these unsaved edits.
  await page.evaluate(async () => {
    const { settings } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...settings, microphoneId: 'other-tab' } });
  });
  await expect(page.getByLabel('Anthropic API key')).toHaveValue(
    'sk-ant-test-not-a-real-key-000000',
  );
  await expect(page.getByLabel('Project name')).toHaveValue('Unsaved draft');
  await page.getByRole('button', { name: 'Save settings' }).click();
  const settings = await stored(page);
  expect(settings.answerProvider).toBe('anthropic');
  expect(settings.anthropicKey).toBe('sk-ant-test-not-a-real-key-000000');
  expect(settings.microphoneId).toBe('other-tab');
  expect(settings.token).toBeUndefined();
});

test('preflight success and a provider failure are visible before recording', async () => {
  const { buildApp } = await import('./helpers/hub-server');
  const { ProviderError } = await import('../packages/core/src/recommendations/errors');
  let audioFrames = 0,
    checks = 0;
  const app = await buildApp({
    configured: true,
    recommend: async () => ({
      action: 'skip',
      responseType: 'none' as const,
      category: 'none',
      triggerSegmentIds: [],
      topicKey: '',
      recommendation: '',
      suggestedResponse: '',
      groundedFactIds: [],
      missingInformation: [],
    }),
    transcriber: () => ({
      connect: async () => {
        checks++;
        if (checks > 1)
          throw new ProviderError(
            'API_ACCESS',
            'OpenAI access denied. Check your API key and model access.',
          );
      },
      append: () => {
        audioFrames++;
      },
      commit: () => {},
      close: () => {},
    }),
  });
  await app.listen({ host: '127.0.0.1', port: 4327 });
  try {
    const page = await panel();
    await page.getByRole('button', { name: 'Check', exact: true }).click();
    const readiness = page.getByRole('region', { name: 'Before your meeting' });
    await expect(readiness.getByRole('status')).toContainText(
      'Ready. Transcription and answers both work.',
    );
    expect(checks).toBe(1);
    expect(audioFrames).toBe(0);
    await page.getByRole('button', { name: 'Check', exact: true }).click();
    await expect(readiness.getByRole('status')).toContainText('OpenAI access denied');
    expect(checks).toBe(2);
    expect(audioFrames).toBe(0);
  } finally {
    await app.close();
  }
});

test('practice question renders grounded evidence, clears when edited, and never captures audio', async () => {
  const { buildApp } = await import('./helpers/hub-server');
  const { factsFromContext } = await import('../packages/shared/src/index');
  let openedAudio = false;
  const app = await buildApp({
    configured: true,
    transcriber: () => {
      openedAudio = true;
      throw new Error('Practice must not capture');
    },
    recommend: async (input) => ({
      action: 'suggest',
      responseType: 'answer' as const,
      category: 'question',
      triggerSegmentIds: ['check'],
      topicKey: 'pilot',
      recommendation: 'Clarify what remains unconfirmed.',
      suggestedResponse:
        'The pilot has not been completed. We should agree the scope before committing to results.',
      groundedFactIds: [factsFromContext(input.project.context)[0].id],
      missingInformation: ['Approved pilot scope'],
    }),
  });
  await app.listen({ host: '127.0.0.1', port: 4327 });
  try {
    const page = await panel();
    await page.getByText('Try a practice question', { exact: true }).click();
    await page.getByLabel('Practice question').fill('Can we confirm the pilot results?');
    await page.getByRole('button', { name: 'Try it', exact: true }).click();
    const result = page.getByRole('article', { name: 'Practice result' });
    await expect(result).toContainText('The pilot has not been completed');
    await expect(result).toContainText('Approved pilot scope');
    await result.getByText('Context used (1)', { exact: true }).click();
    await expect(result).toContainText(saved.project.context);
    expect(openedAudio).toBe(false);
    await page.getByLabel('Practice question').fill('A new question');
    await expect(result).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('personal profile persists without replacing the project and drafts are labelled everywhere', async () => {
  const { initialState, factsForProject } = await import('@noclue/shared');
  const page = await panel();
  await expect(page.getByLabel('About me')).toHaveValue('');
  await page.getByLabel('About me').fill('My name is Alex. I enjoy simplifying difficult ideas.');
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  const settings = await stored(page);
  expect(settings.project.context).toBe(saved.project.context);
  expect(settings.project.aboutMe).toContain('My name is Alex');
  await page.reload();
  await page.getByRole('button', { name: /^Settings/ }).click();
  await expect(page.getByLabel('About me')).toHaveValue(settings.project.aboutMe);
  const decision = {
    action: 'suggest' as const,
    responseType: 'draft' as const,
    category: 'question' as const,
    triggerSegmentIds: ['check'],
    topicKey: 'motivation',
    recommendation: 'Use this only if it fits.',
    suggestedResponse: 'I enjoy turning difficult ideas into useful tools.',
    groundedFactIds: [
      factsForProject(settings.project).find((f) => f.id.startsWith('personal-'))!.id,
    ],
    missingInformation: ['Motivation for this role'],
  };
  await page.routeWebSocket('ws://127.0.0.1:4327/session', (ws) => {
    ws.onMessage((raw) => {
      const message = JSON.parse(String(raw));
      if (message.type === 'authenticate')
        ws.send(JSON.stringify({ type: 'authenticated', protocolVersion: PROTOCOL_VERSION }));
      if (message.type === 'context.preview') {
        expect(message.project.aboutMe).toBe(settings.project.aboutMe);
        ws.send(JSON.stringify({ type: 'context.preview.ready', decision }));
      }
    });
  });
  await page.getByText('Try a practice question', { exact: true }).click();
  await page.getByLabel('Practice question').fill('What motivated you?');
  await page.getByRole('button', { name: 'Try it', exact: true }).click();
  const practice = page.getByRole('article', { name: 'Practice result' });
  await expect(practice).toContainText('Draft · adapt it to you');
  await practice.getByText('Context used (1)', { exact: true }).click();
  await expect(practice).toContainText(settings.project.aboutMe);
  const state = {
    ...initialState(),
    active: true,
    status: 'Listening' as const,
    suggestions: [
      { ...decision, requestId: 'draft-test', at: Date.now(), mode: 'manual' as const },
    ],
  };
  const worker = context.serviceWorkers()[0];
  await worker.evaluate(
    (state) => chrome.runtime.sendMessage({ target: 'panel', type: 'state', state }),
    state,
  );
  await expect(page.locator('.suggestion')).toContainText('Draft · adapt it to you');
  await expect(page.locator('.suggestion .response')).toHaveText(decision.suggestedResponse);
  await mountTestCue(page);
  await worker.evaluate((state) => chrome.runtime.sendMessage({ target: 'cue', state }), state);
  await expect(page.locator('#noclue-cue .draft')).toBeVisible();
  await expect(page.locator('#noclue-cue .answer')).toHaveText(decision.suggestedResponse);
  state.suggestions[0].responseType = 'answer' as any;
  await worker.evaluate((state) => chrome.runtime.sendMessage({ target: 'cue', state }), state);
  await expect(page.locator('#noclue-cue .draft')).toBeHidden();
});

test('version label sits in the lower-right corner of every page', async () => {
  for (const path of ['sidepanel.html', 'setup.html']) {
    const page = await context.newPage();
    await page.goto(`${origin}/${path}`);
    const badge = page.getByTestId('app-version');
    await expect(badge).toContainText(`v${APP_VERSION}`);
    const box = (await badge.boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(viewport.width - (box.x + box.width)).toBeLessThan(24);
    expect(viewport.height - (box.y + box.height)).toBeLessThan(24);
    await page.close();
  }
});
