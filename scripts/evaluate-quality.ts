import { config } from 'dotenv';
import { createHash } from 'node:crypto';
import { EVIDENCE_REVIEW_VERSION } from '../packages/core/src/recommendations/grounding.js';
import { dirname, resolve } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRecommender } from '../packages/core/src/recommendations/provider.js';
import { PROMPT_VERSION, factsForProject, ProjectSchema } from '@noclue/shared';
config();
const args = process.argv.slice(2);
const option = (name: string, fallback: string) => {
  const index = args.indexOf(name);
  return index < 0 ? fallback : args[index + 1] || fallback;
};
const fixturePath = resolve(option('--fixture', 'tests/fixtures/quality-scenarios.json'));
const outputPath = resolve(option('--output', 'eval-results/quality.json'));
const fixtureText = await readFile(fixturePath, 'utf8');
const fixture = JSON.parse(fixtureText);
const fixtureSha256 = createHash('sha256').update(fixtureText).digest('hex');
if (!Array.isArray(fixture.scenarios) || !fixture.scenarios.length)
  throw new Error('No quality scenarios supplied.');
if (!process.env.OPENAI_API_KEY) {
  console.error(
    `Set OPENAI_API_KEY in .env. This evaluation sends the selected project context to OpenAI in ${fixture.scenarios.length} scenarios; generation, review and at most one repair incur billed API calls.`,
  );
  process.exit(1);
}
const project = ProjectSchema.parse(fixture.project),
  recommend = createRecommender(
    process.env.OPENAI_API_KEY,
    process.env.RECOMMENDATION_MODEL || 'gpt-4.1-mini',
  );
const results = [];
for (const scenario of fixture.scenarios) {
  const started = Date.now();
  const audit: unknown[] = [];
  try {
    const result = await recommend(
      {
        project: ProjectSchema.parse({ ...project, ...scenario.project }),
        level: 'QUICK',
        audit: (event) => audit.push(event),
        question: scenario.utterance,
        segments: [
          ...(scenario.priorUtterances ?? []).map((text: string, i: number) => ({
            id: `${scenario.id}-prior-${i}`,
            sequence: i,
            text,
            at: started,
            final: true,
          })),
          {
            id: scenario.id,
            sequence: (scenario.priorUtterances ?? []).length,
            text: scenario.utterance,
            at: started,
            final: true,
          },
        ],
        recent: [],
        newSegmentIds: [scenario.id],
        mode: scenario.mode ?? 'automatic',
      },
      AbortSignal.timeout(15000),
    );
    results.push({
      ...scenario,
      result,
      audit,
      questionId: scenario.id,
      promptVersion: PROMPT_VERSION,
      sources: factsForProject({ ...project, ...scenario.project }).filter((f) =>
        result.groundedFactIds.includes(f.id),
      ),
      generationStartedAt: started,
      quickReadyAt: Date.now(),
      modelLatencyMs: Date.now() - started,
      humanReview: {
        useful: null,
        english: null,
        grounded: null,
        claimStatusAccurate: null,
        speakability: null,
        unsupportedCommitment: null,
      },
    });
  } catch (error) {
    results.push({
      ...scenario,
      audit,
      error: error instanceof Error ? error.message : 'Request failed',
      errorCode: (error as { code?: string }).code ?? 'UNKNOWN',
      modelLatencyMs: Date.now() - started,
    });
  }
  console.log(`Evaluated ${scenario.id}`);
}
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(
  outputPath,
  JSON.stringify(
    {
      warning: fixture.warning,
      fixtureSha256,
      reviewVersion: EVIDENCE_REVIEW_VERSION,
      measuredAt: new Date().toISOString(),
      promptVersion: PROMPT_VERSION,
      missingAnswers: results
        .filter((r) => !('result' in r) || r.result.action !== 'suggest')
        .map((r) => r.id),
      model: process.env.RECOMMENDATION_MODEL || 'gpt-4.1-mini',
      note: 'Model latency only, not end-to-end audio latency. Human review required; no automatic pass claimed.',
      results,
    },
    null,
    2,
  ) + '\n',
);
console.log(`Saved ${outputPath}. Review each result against expected behavior.`);
