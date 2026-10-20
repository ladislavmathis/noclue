// Fails when a real-looking API key is committed or would be published. Run in CI and
// before every release: npm run secrets:check [directory]
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const root = resolve(process.argv[2] ?? '.');
/** Files git would publish; for a plain folder (a fresh export), every file except node_modules. */
function listFiles() {
  try {
    return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split('\n')
      .filter(Boolean);
  } catch {
    const walk = (dir) =>
      readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) => {
        const path = dir ? `${dir}/${entry.name}` : entry.name;
        if (entry.name === 'node_modules' || entry.name === '.git') return [];
        return entry.isDirectory() ? walk(path) : [path];
      });
    return walk('');
  }
}
const files = listFiles();
// Real keys are long. Test fixtures use obviously fake values such as sk-test-….
const patterns = [
  { name: 'OpenAI key', re: /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{40,}/ },
  { name: 'Anthropic key', re: /\bsk-ant-(?:api|admin)\d{2}-[A-Za-z0-9_-]{40,}/ },
  { name: 'Private key block', re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
];
const allowed = (match) => /^sk-(?:ant-)?test/.test(match);
let problems = 0;
for (const file of files) {
  const path = join(root, file);
  let text;
  try {
    if (statSync(path).size > 2_000_000) continue;
    text = readFileSync(path, 'utf8');
  } catch {
    continue;
  }
  if (text.includes('\u0000')) continue; // binary
  for (const { name, re } of patterns) {
    const match = text.match(re);
    if (match && !allowed(match[0])) {
      problems++;
      console.error(`${name} in ${relative(process.cwd(), path)}`);
    }
  }
}
if (files.includes('.env')) {
  problems++;
  console.error('.env must never be committed.');
}
if (problems) {
  console.error(`${problems} possible secret(s) found. Remove them before committing.`);
  process.exit(1);
}
console.log(`No secrets found in ${files.length} files.`);
