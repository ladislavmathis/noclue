// Fails when a real-looking API key is committed or would be published. Run in CI and
// before every release: npm run secrets:check [directory]
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';

const root = resolve(process.argv[2] ?? '.');
/** Files git would publish; for a plain folder (a fresh export), every file except node_modules. */
function listFiles() {
  try {
    return execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split('\0')
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
  { name: 'OpenAI key', re: /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{40,}/g },
  { name: 'Anthropic key', re: /\bsk-ant-(?:api|admin)\d{2}-[A-Za-z0-9_-]{40,}/g },
  { name: 'GitHub token', re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})/g },
  { name: 'AWS access key ID', re: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  { name: 'Google API key', re: /\bAIza[A-Za-z0-9_-]{35}\b/g },
  { name: 'Slack token', re: /\bxox[baprs]-[A-Za-z0-9-]{20,}/g },
  { name: 'Stripe live key', re: /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}/g },
  {
    name: 'Private key block',
    re: /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/g,
  },
];
const allowed = (match) => /^sk-(?:ant-)?test/.test(match);
let problems = 0;
for (const file of files) {
  const path = join(root, file);
  const name = basename(file);
  if ((name === '.env' || name.startsWith('.env.')) && name !== '.env.example') {
    problems++;
    console.error(`Environment file must not be published: ${relative(process.cwd(), path)}`);
  }
  let text;
  try {
    if (!statSync(path).isFile()) continue;
    text = readFileSync(path, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') {
      problems++;
      console.error(`Could not scan ${relative(process.cwd(), path)}`);
    }
    continue;
  }
  if (text.includes('\u0000')) continue; // binary
  for (const { name, re } of patterns) {
    if ([...text.matchAll(re)].some((match) => !allowed(match[0]))) {
      problems++;
      console.error(`${name} in ${relative(process.cwd(), path)}`);
    }
  }
}
if (problems) {
  console.error(`${problems} possible secret(s) found. Remove them before committing.`);
  process.exit(1);
}
console.log(`No known secret patterns found in ${files.length} files.`);
