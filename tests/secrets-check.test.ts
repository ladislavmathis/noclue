import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const script = fileURLToPath(new URL('../scripts/check-secrets.mjs', import.meta.url));
function scan(file: string, content: string) {
  const root = mkdtempSync(join(tmpdir(), 'noclue-secret-check-'));
  try {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), content);
    return spawnSync(process.execPath, [script, root], { cwd: root, encoding: 'utf8' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

it('finds a secret after an allowed fake key without printing either value', () => {
  const fake = 'sk-test-' + 'a'.repeat(50);
  const secret = 'sk-proj-' + 'b'.repeat(50);
  const result = scan('fixture.txt', `${fake}\n${secret}`);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('OpenAI key');
  expect(result.stderr).not.toContain(secret);
  expect(result.stderr).not.toContain(fake);
});

it.each([
  ['GitHub token', 'ghp_' + 'a'.repeat(36)],
  ['AWS access key ID', 'AKIA' + 'A'.repeat(16)],
  ['Google API key', 'AIza' + 'b'.repeat(35)],
  ['Slack token', 'xoxb-' + 'c'.repeat(25)],
  ['Stripe live key', 'sk_live_' + 'd'.repeat(24)],
])('rejects a %s', (label, secret) => {
  const result = scan('fixture.txt', secret);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(label);
  expect(result.stderr).not.toContain(secret);
});

it('rejects nested environment files and allows the example template', () => {
  expect(scan('nested/.env.local', 'VALUE=placeholder').status).toBe(1);
  expect(scan('nested/.env.example', 'VALUE=placeholder').status).toBe(0);
});

it('scans text beyond the former size limit', () => {
  expect(scan('large.txt', ' '.repeat(2_000_001) + 'ghp_' + 'a'.repeat(36)).status).toBe(1);
});
