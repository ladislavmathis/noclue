import { cp, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
// Test build (npm run build:test) only: its fake hub URL is rewritten to an isolated port.
export async function isolatedExtension(profile: string, port = 4327) {
  const destination = join(profile, 'extension');
  await cp(resolve('apps/extension/dist-test'), destination, { recursive: true });
  const rewrite = async (directory: string) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await rewrite(path);
      else if (entry.name.endsWith('.js') || entry.name === 'manifest.json') {
        const content = await readFile(path, 'utf8');
        await writeFile(path, content.replaceAll('127.0.0.1:4317', `127.0.0.1:${port}`));
      }
    }
  };
  await rewrite(destination);
  return destination;
}
