import { beforeEach, describe, expect, it, vi } from 'vitest';
const create = vi.hoisted(() => vi.fn());
const constructed = vi.hoisted(() => [] as any[]);
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    beta = { messages: { create } };
    constructor(options: any) {
      constructed.push(options);
    }
  },
}));
import { anthropicModel } from '../packages/core/src/recommendations/llm';
import { createProviderRecommender } from '../packages/core/src/recommendations/provider';
import { safeError } from '../packages/core/src/recommendations/errors';
import { QuickDecisionSchema, factsFromContext } from '@noclue/shared';

const message = (text: string, stop_reason = 'end_turn') => ({
  stop_reason,
  content: [
    { type: 'thinking', thinking: '' },
    { type: 'text', text },
  ],
});
const request = {
  schema: QuickDecisionSchema,
  name: 'meeting_recommendation',
  instructions: 'System rules',
  input: '{"question":"x"}',
  maxTokens: 600,
};
beforeEach(() => {
  create.mockReset();
  constructed.length = 0;
});

describe('Anthropic structured model', () => {
  it('calls Claude directly from the browser with JSON schema output and low effort', async () => {
    create.mockResolvedValue(message('{"ok":true}'));
    const llm = anthropicModel('sk-ant-test', 'claude-opus-5-5');
    const result = await llm.complete(request, new AbortController().signal);
    expect(result).toEqual({ ok: true, json: { ok: true } });
    expect(constructed[0]).toMatchObject({
      apiKey: 'sk-ant-test',
      maxRetries: 0,
      dangerouslyAllowBrowser: true,
    });
    const [body, options] = create.mock.calls[0];
    expect(body.model).toBe('claude-opus-5-5');
    expect(body.max_tokens).toBeGreaterThan(600);
    expect(body.system).toEqual([
      { type: 'text', text: 'System rules', cache_control: { type: 'ephemeral' } },
    ]);
    expect(body.messages).toEqual([{ role: 'user', content: '{"question":"x"}' }]);
    expect(body.output_config.effort).toBe('low');
    expect(body.output_config.format.type).toBe('json_schema');
    expect(body.output_config.format.schema.type).toBe('object');
    // Constraints Claude structured outputs cannot enforce are moved out of the schema.
    expect(JSON.stringify(body.output_config.format.schema)).not.toMatch(/"maxLength"|"maxItems"/);
    expect(body).not.toHaveProperty('thinking');
    expect(body.betas).toEqual(['server-side-fallback-2026-07-01']);
    expect(body.fallbacks).toBe('default');
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });
  it('sends no fallback parameter for Haiku, which has no server-side fallback', async () => {
    create.mockResolvedValue(message('{}'));
    await anthropicModel('k', 'claude-haiku-5-5').complete(request, new AbortController().signal);
    expect(create.mock.calls[0][0]).not.toHaveProperty('fallbacks');
    expect(create.mock.calls[0][0]).not.toHaveProperty('betas');
  });
  it('reports refusal, truncation and invalid JSON without throwing', async () => {
    const llm = anthropicModel('k', 'claude-sonnet-5-5');
    const signal = new AbortController().signal;
    create.mockResolvedValueOnce({ stop_reason: 'refusal', content: [] });
    expect(await llm.complete(request, signal)).toEqual({ ok: false, reason: 'refusal' });
    create.mockResolvedValueOnce(message('{"a":', 'max_tokens'));
    expect(await llm.complete(request, signal)).toEqual({ ok: false, reason: 'incomplete' });
    create.mockResolvedValueOnce(message('not json'));
    expect(await llm.complete(request, signal)).toEqual({ ok: false, reason: 'invalid' });
    create.mockResolvedValueOnce({ stop_reason: 'end_turn', content: [] });
    expect(await llm.complete(request, signal)).toEqual({ ok: false, reason: 'incomplete' });
  });
  it('maps Anthropic HTTP errors to calm provider messages', () => {
    expect(safeError({ status: 401 }, 'Anthropic')).toMatchObject({
      code: 'API_ACCESS',
      message: 'Anthropic access denied. Check your API key and model access.',
    });
    expect(
      safeError({ status: 429, headers: new Headers({ 'retry-after': '3' }) }, 'Anthropic'),
    ).toMatchObject({ code: 'RATE_LIMIT', retryable: true, retryAfterMs: 3000 });
    expect(
      safeError(
        {
          status: 400,
          error: {
            type: 'error',
            error: { type: 'invalid_request_error', message: 'Your credit balance is too low.' },
          },
        },
        'Anthropic',
      ),
    ).toMatchObject({ code: 'API_BILLING', retryable: false });
    expect(safeError({ status: 529 }, 'Anthropic')).toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
      retryable: true,
    });
  });
});

describe('Anthropic recommender', () => {
  const project = {
    name: 'Fictional',
    role: 'Lead',
    goal: 'Clarify',
    context: 'The pilot has not been completed.',
    keywords: [],
  };
  const factId = factsFromContext(project.context)[0].id;
  it('generates, reviews and returns a checked answer through Claude', async () => {
    const answer = 'The pilot has not been completed yet.';
    create
      .mockResolvedValueOnce(
        message(
          JSON.stringify({
            action: 'suggest',
            responseType: 'answer',
            category: 'question',
            triggerSegmentIds: ['s1'],
            topicKey: 'pilot',
            recommendation: 'State the status plainly.',
            suggestedResponse: answer,
            groundedFactIds: [factId],
            missingInformation: [],
            questionComplete: true,
            evidenceConflict: false,
            projectClaims: [{ factId, status: null }],
          }),
        ),
      )
      .mockResolvedValueOnce(
        message(
          JSON.stringify({
            assessments: [
              {
                sentenceId: 0,
                kind: 'PROJECT',
                factIds: [factId],
                explanation: 'Directly stated.',
                supported: true,
              },
            ],
            issues: [],
          }),
        ),
      );
    const recommend = createProviderRecommender('anthropic', 'sk-ant-test', 'claude-opus-5-5');
    const result = await recommend(
      {
        project,
        segments: [
          { id: 's1', sequence: 0, text: 'Is the pilot done?', at: Date.now(), final: true },
        ],
        recent: [],
        mode: 'manual',
        level: 'QUICK',
        question: 'Is the pilot done?',
      },
      new AbortController().signal,
    );
    expect(result.suggestedResponse).toBe(answer);
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1][0].system[0].text).toContain('skeptical evidence reviewer');
  });
  it('labels an access failure with the Anthropic provider name', async () => {
    create.mockRejectedValue(Object.assign(new Error('denied'), { status: 401 }));
    const recommend = createProviderRecommender('anthropic', 'bad', 'claude-sonnet-5-5');
    await expect(
      recommend(
        {
          project,
          segments: [{ id: 's1', sequence: 0, text: 'Hello?', at: Date.now(), final: true }],
          recent: [],
          mode: 'manual',
          level: 'QUICK',
        },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'API_ACCESS', message: expect.stringContaining('Anthropic') });
  });
});
