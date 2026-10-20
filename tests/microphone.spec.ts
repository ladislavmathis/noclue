import { isolatedExtension } from './helpers/extension';
import { test, expect, chromium } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

for (const speech of [true, false])
  test(`microphone readiness requires actual detected speech: ${speech ? 'voice' : 'silence'}`, async () => {
    const profile = await mkdtemp(join(tmpdir(), 'noclue-mic-readiness-'));
    const silence = Buffer.alloc(44 + 48000 * 2);
    silence.write('RIFF', 0);
    silence.writeUInt32LE(silence.length - 8, 4);
    silence.write('WAVEfmt ', 8);
    silence.writeUInt32LE(16, 16);
    silence.writeUInt16LE(1, 20);
    silence.writeUInt16LE(1, 22);
    silence.writeUInt32LE(48000, 24);
    silence.writeUInt32LE(96000, 28);
    silence.writeUInt16LE(2, 32);
    silence.writeUInt16LE(16, 34);
    silence.write('data', 36);
    silence.writeUInt32LE(silence.length - 44, 40);
    const silentPath = join(profile, 'silence.wav');
    await writeFile(silentPath, silence);
    const extension = await isolatedExtension(profile);
    const context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium',
      headless: true,
      args: [
        `--disable-extensions-except=${extension}`,
        `--load-extension=${extension}`,
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        `--use-file-for-fake-audio-capture=${speech ? resolve('tests/fixtures/meeting-speech.wav') : silentPath}`,
      ],
    });
    try {
      const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
      const origin = `chrome-extension://${new URL(worker.url()).host}`;
      const page = await context.newPage();
      const sockets: string[] = [];
      page.on('websocket', (ws) => sockets.push(ws.url()));
      await page.goto(`${origin}/setup.html#microphone`);
      await page.getByRole('button', { name: 'Allow microphone & test' }).click();
      await expect(page.getByRole('status')).toContainText('Speak normally');
      if (speech)
        await expect(page.getByText('Speech detected', { exact: true })).toBeVisible({
          timeout: 8000,
        });
      await expect(page.getByRole('status')).toContainText(
        speech ? 'Speech detected. Choose Save' : 'no speech was heard',
        { timeout: 15000 },
      );
      const check = await page.evaluate(
        async () => (await chrome.storage.local.get('microphoneCheck')).microphoneCheck,
      );
      expect(check.speechDetected).toBe(speech);
      await page.getByRole('button', { name: 'Save microphone' }).click();
      const saved = await page.evaluate(async () =>
        chrome.storage.local.get(['microphoneCheck', 'settings']),
      );
      expect(saved.microphoneCheck.deviceId).toBe(saved.settings.microphoneId);
      expect(saved.microphoneCheck.speechDetected).toBe(speech);
      expect(sockets).toEqual([]);
    } finally {
      await context.close();
      await rm(profile, { recursive: true, force: true });
    }
  });
