import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { APP_VERSION } from '@noclue/shared';

const json = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
it('keeps one release version across package, manifest and UI', () => {
  expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  expect(json('../package.json').version).toBe(APP_VERSION);
  expect(json('../apps/extension/public/manifest.json').version).toBe(APP_VERSION);
});
it('documents every release in the changelog', () => {
  const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  // Keep a Changelog headings: `## [0.5.0] - 2026-10-20`.
  expect(changelog).toMatch(new RegExp(`^## \\[${APP_VERSION.replaceAll('.', '\\.')}\\]`, 'm'));
});
