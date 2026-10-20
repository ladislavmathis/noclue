// Zips the production build for the Chrome Web Store and GitHub Releases:
// npm run package  ->  release/noclue-<version>.zip
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'apps/extension/dist');
const manifest = JSON.parse(readFileSync(resolve(dist, 'manifest.json'), 'utf8'));
const { version } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
if (manifest.version !== version) throw new Error('Build is stale: run npm run build first.');
if (JSON.stringify(manifest).includes('127.0.0.1'))
  throw new Error('This is a test build (localhost permission). Run npm run build.');
for (const required of ['NOTICES.txt', 'icons/icon-128.png', 'vad/silero_vad_v5.onnx'])
  if (!existsSync(resolve(dist, required))) throw new Error(`Missing ${required} in the build.`);
mkdirSync(resolve(root, 'release'), { recursive: true });
const zip = resolve(root, 'release', `noclue-${version}.zip`);
rmSync(zip, { force: true });
execFileSync('zip', ['-r', '-X', '-q', zip, '.', '-x', '*.DS_Store'], { cwd: dist });
console.log(`Wrote ${zip}`);
