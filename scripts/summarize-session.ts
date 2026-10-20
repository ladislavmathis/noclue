import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { summarizeTest } from '../packages/shared/src/metrics';
import type { TestLog } from '@noclue/shared';
const [input, output] = process.argv.slice(2);
if (!input) throw new Error('Usage: npm run eval:session -- exported-test.json [summary.json]');
const log = JSON.parse(await readFile(resolve(input), 'utf8')) as TestLog;
if (log.version !== 2 || !Array.isArray(log.events))
  throw new Error('Expected a version 2 test export.');
const summary = summarizeTest(log);
if (output) await writeFile(resolve(output), JSON.stringify(summary, null, 2) + '\n');
else console.log(JSON.stringify(summary, null, 2));
