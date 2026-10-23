import { defineConfig } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
const root = dirname(fileURLToPath(import.meta.url));
// Root package.json is the single source of the release version.
const version: string = JSON.parse(
  readFileSync(resolve(root, '../../package.json'), 'utf8'),
).version;
// `npm run build:test` (NOCLUE_TEST_HUB=1) builds dist-test for browser tests: it connects
// to a local fake hub instead of running the hub in-page. Tests rewrite 4317 to their port.
// The production build has no localhost permission at all.
const testHub = process.env.NOCLUE_TEST_HUB === '1';
const outDir = testHub ? 'dist-test' : 'dist';
export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    __TEST_HUB_URL__: JSON.stringify(testHub ? 'ws://127.0.0.1:4317/session' : ''),
  },
  build: {
    outDir,
    emptyOutDir: true,
    rollupOptions: {
      input: {
        sidepanel: resolve(root, 'sidepanel.html'),
        setup: resolve(root, 'setup.html'),
        offscreen: resolve(root, 'offscreen.html'),
        background: resolve(root, 'src/background/index.ts'),
        shareObserver: resolve(root, 'src/background/share-observer.ts'),
        pcm: resolve(root, 'src/audio/pcm-worklet.ts'),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === 'background'
            ? 'background.js'
            : chunk.name === 'shareObserver'
              ? 'share-observer.js'
              : chunk.name === 'pcm'
                ? 'pcm-worklet.js'
                : 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
      },
    },
  },
  plugins: [
    {
      name: 'bundle-local-vad',
      async closeBundle() {
        const manifestPath = resolve(root, outDir, 'manifest.json');
        const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
        manifest.version = version;
        if (testHub) {
          manifest.name = 'noclue (test build)';
          manifest.host_permissions = [...manifest.host_permissions, 'http://127.0.0.1/*'];
          manifest.content_security_policy.extension_pages =
            manifest.content_security_policy.extension_pages.replace(
              "connect-src 'self'",
              "connect-src 'self' http://127.0.0.1:4317 ws://127.0.0.1:4317",
            );
        }
        await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
        // Full third-party license texts ship with every build (NOTICES.md lists them).
        const licenseSources = [
          ['vad-web', resolve(root, '../../licenses/ISC-vad-web.txt')],
          ['Silero VAD model', resolve(root, '../../licenses/MIT-Silero.txt')],
          ['ONNX Runtime Web', resolve(root, '../../licenses/MIT-onnxruntime.txt')],
          ['React', resolve(root, '../../node_modules/react/LICENSE')],
          ['React DOM', resolve(root, '../../node_modules/react-dom/LICENSE')],
          ['scheduler', resolve(root, '../../node_modules/scheduler/LICENSE')],
          ['Zod', resolve(root, '../../node_modules/zod/LICENSE')],
          ['OpenAI Node SDK', resolve(root, '../../node_modules/openai/LICENSE')],
          [
            'Anthropic TypeScript SDK',
            resolve(root, '../../node_modules/@anthropic-ai/sdk/LICENSE'),
          ],
          ['json-schema-to-ts', resolve(root, '../../node_modules/json-schema-to-ts/LICENSE')],
          ['Manrope font', resolve(root, 'public/fonts/OFL-Manrope.txt')],
          ['Anta font', resolve(root, 'public/fonts/OFL-Anta.txt')],
        ] as const;
        let notices = 'noclue by ignition - third-party notices\n\n';
        for (const [name, path] of licenseSources)
          notices += `==== ${name} ====\n\n${await readFile(path, 'utf8')}\n\n`;
        await writeFile(resolve(root, outDir, 'NOTICES.txt'), notices);
        const target = resolve(root, outDir, 'vad');
        await mkdir(target, { recursive: true });
        for (const name of ['silero_vad_v5.onnx', 'vad.worklet.bundle.min.js'])
          await copyFile(
            resolve(root, '../../node_modules/@ricky0123/vad-web/dist', name),
            resolve(target, name),
          );
        for (const name of ['ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.mjs'])
          await copyFile(
            resolve(root, '../../node_modules/onnxruntime-web/dist', name),
            resolve(target, name),
          );
      },
    },
  ],
});
