import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests',
  testMatch: [
    'browser.spec.ts',
    'user-journeys.spec.ts',
    'capture.spec.ts',
    'microphone.spec.ts',
    'voice-routing.spec.ts',
  ],
  workers: 1,
  timeout: 60000,
  reporter: 'list',
  outputDir: 'test-results',
});
