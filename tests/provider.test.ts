import { beforeEach, describe, it, expect, vi } from 'vitest';
const create = vi.hoisted(() => vi.fn());
vi.mock('openai', () => ({
  default: class {
    responses = { create };
  },
}));
import { createRecommender } from '../packages/core/src/recommendations/provider';
import { ALL_FALLBACKS } from '../packages/core/src/recommendations/quick';
const base = {
  action: 'suggest',
  responseType: 'answer' as const,
  category: 'question',
  triggerSegmentIds: ['s1'],
  topicKey: 'clarify',
  recommendation: 'Ask for clarification.',
  suggestedResponse: 'Could you clarify the expected scope?',
  groundedFactIds: [],
  missingInformation: ['Scope'],
};
const input = {
  project: {
    name: 'Fixture',
    role: 'Lead',
    goal: 'Clarify',
    context: 'No scope confirmed.',
    keywords: [],
    preferences: {
      tone: 'professional' as const,
      length: 'standard' as const,
      strictContext: false,
      silenceMs: 700,
    },
  },
  segments: [{ id: 's1', sequence: 0, text: 'What is the scope?', at: 0, final: true }],
  recent: [],
  mode: 'automatic' as const,
};
beforeEach(() => {
  create.mockReset();
});
describe('AI adapter', () => {
  it('applies style, length and strictness as controlled instructions while preserving grounding rules', async () => {
    create.mockResolvedValue({
      status: 'completed',
      output: [],
      output_text: JSON.stringify(base),
    });
    await createRecommender('test', 'test-model')(
      {
        ...input,
        project: {
          ...input.project,
          preferences: {
            tone: 'executive',
            length: 'detailed',
            strictContext: false,
            silenceMs: 1500,
          },
        },
      },
      new AbortController().signal,
    );
    const sent = create.mock.calls[0][0];
    expect(sent.instructions).toContain('decision-oriented');
    expect(sent.instructions).toContain('4–7 sentences');
    expect(sent.instructions).toContain('Strict context OFF');
    expect(sent.instructions).toContain('must still be supported');
    expect(sent.max_output_tokens).toBe(1300);
  });
  it.each(['credit_balance_exhausted', 'insufficient_quota', 'project_spend_limit_exceeded'])(
    'does not retry billing error %s as a temporary rate limit',
    async (code) => {
      create.mockRejectedValue({ status: 429, code, type: 'insufficient_quota' });
      await expect(
        createRecommender('test', 'test-model')(input, new AbortController().signal),
      ).rejects.toMatchObject({ code: 'API_BILLING', retryable: false });
    },
  );
  it('uses non-stored structured Responses requests and explicit unknown own speech', async () => {
    create.mockResolvedValue({
      status: 'completed',
      output: [],
      output_text: JSON.stringify(base),
    });
    const result = await createRecommender('test', 'test-model')(
      input,
      new AbortController().signal,
    );
    expect(result).toEqual(base);
    const request = create.mock.calls[0][0];
    expect(request.store).toBe(false);
    expect(request.text.format.type).toBe('json_schema');
    expect(JSON.parse(request.input).ownSpeechContent).toBe('unavailable');
  });
  it.each([
    [{ status: 'incomplete', output: [], output_text: '' }, 'INCOMPLETE_OUTPUT'],
    [
      {
        status: 'completed',
        output: [{ type: 'message', content: [{ type: 'refusal' }] }],
        output_text: '',
      },
      'MODEL_REFUSAL',
    ],
    [{ status: 'completed', output: [], output_text: 'not json' }, 'INVALID_OUTPUT'],
    [
      {
        status: 'completed',
        output: [],
        output_text: JSON.stringify({ ...base, groundedFactIds: ['invented'] }),
      },
      'INVALID_GROUNDING',
    ],
    [
      {
        status: 'completed',
        output: [],
        output_text: JSON.stringify({ ...base, triggerSegmentIds: ['missing'] }),
      },
      'INVALID_GROUNDING',
    ],
  ])('rejects unsafe or unusable provider output %#', async (output, code) => {
    create.mockResolvedValue(output);
    await expect(
      createRecommender('test', 'test-model')(input, new AbortController().signal),
    ).rejects.toHaveProperty('code', code);
  });
  it('does not expose provider error bodies or API keys', async () => {
    create.mockRejectedValue({ status: 401, message: 'SECRET_KEY project context' });
    await expect(
      createRecommender('test', 'test-model')(input, new AbortController().signal),
    ).rejects.toMatchObject({
      code: 'API_ACCESS',
      message: 'OpenAI access denied. Check your API key and model access.',
    });
  });
});

it('marks new discussion separately and rejects an automatic answer triggered only by old context', async () => {
  create.mockResolvedValue({ status: 'completed', output: [], output_text: JSON.stringify(base) });
  const newer = { id: 's2', sequence: 1, text: 'What about evaluation?', at: 1, final: true };
  await expect(
    createRecommender('test', 'model')(
      { ...input, segments: [...input.segments, newer], newSegmentIds: ['s2'] },
      new AbortController().signal,
    ),
  ).rejects.toHaveProperty('code', 'INVALID_GROUNDING');
  const sent = JSON.parse(create.mock.calls[0][0].input);
  expect(sent.newSegmentIds).toEqual(['s2']);
  expect(sent.transcript).toHaveLength(2);
});

it('accepts personal evidence with a distinct namespace and passes it separately', async () => {
  const { factsForProject } = await import('@noclue/shared');
  const project = { ...input.project, aboutMe: 'I enjoy making complex tools useful.' };
  const personal = factsForProject(project).find((f) => f.id.startsWith('personal-'))!;
  create.mockResolvedValue({
    status: 'completed',
    output: [],
    output_text: JSON.stringify({
      ...base,
      responseType: 'answer',
      groundedFactIds: [personal.id],
      suggestedResponse: 'I enjoy making complex tools useful.',
    }),
  });
  const result = await createRecommender('test', 'test-model')(
    { ...input, project },
    new AbortController().signal,
  );
  expect(result.groundedFactIds).toEqual([personal.id]);
  const payload = JSON.parse(create.mock.calls[0][0].input);
  expect(payload.project.personalFacts).toEqual([personal]);
  expect(payload.project.facts.some((f: { id: string }) => f.id === personal.id)).toBe(false);
});

it.each(['answer', 'draft', 'clarification'] as const)(
  'carries %s through the structured response',
  async (responseType) => {
    create.mockResolvedValue({
      status: 'completed',
      output: [],
      output_text: JSON.stringify({ ...base, responseType }),
    });
    const result = await createRecommender('test', 'test-model')(
      input,
      new AbortController().signal,
    );
    expect(result.responseType).toBe(responseType);
  },
);

it('rejects a suggestion marked as none', async () => {
  create.mockResolvedValue({
    status: 'completed',
    output: [],
    output_text: JSON.stringify({ ...base, responseType: 'none' }),
  });
  await expect(
    createRecommender('test', 'test-model')(input, new AbortController().signal),
  ).rejects.toMatchObject({ code: 'INVALID_OUTPUT' });
});

it('enforces strict mode for an answer without evidence', async () => {
  create.mockResolvedValue({
    status: 'completed',
    output: [],
    output_text: JSON.stringify({ ...base, suggestedResponse: 'Photosynthesis makes glucose.' }),
  });
  const result = await createRecommender('test', 'test-model')(
    {
      ...input,
      project: {
        ...input.project,
        preferences: { ...input.project.preferences, strictContext: true },
      },
    },
    new AbortController().signal,
  );
  expect(result.suggestedResponse).toContain("don't have verified information");
  expect(result.suggestedResponse).not.toContain('glucose');
});

it('normalizes a skip without displaying incidental model explanations', async () => {
  create.mockResolvedValue({
    status: 'completed',
    output: [],
    output_text: JSON.stringify({ ...base, action: 'skip', responseType: 'none' }),
  });
  const result = await createRecommender('test', 'test-model')(input, new AbortController().signal);
  expect(result).toMatchObject({
    action: 'skip',
    responseType: 'none',
    suggestedResponse: '',
    recommendation: '',
    triggerSegmentIds: [],
  });
});

it('uses a separate QUICK schema and reports invalid review as a retryable error', async () => {
  create.mockResolvedValue({
    status: 'completed',
    output: [],
    output_text: JSON.stringify({
      ...base,
      questionComplete: true,
      evidenceConflict: false,
      projectClaims: [],
      suggestedResponse: 'word '.repeat(40),
      missingInformation: [],
    }),
  });
  await expect(
    createRecommender('test', 'test-model')(
      { ...input, level: 'QUICK' },
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ code: 'EVIDENCE_REVIEW_INVALID', retryable: true });
  expect(create).toHaveBeenCalledTimes(3);
  expect(create.mock.calls[0][0].instructions).toContain('B2 spoken English');
  expect(create.mock.calls[0][0].instructions).toContain('1–3 short sentences');
});
it('falls back when sources conflict instead of upgrading to the stronger claim', async () => {
  create.mockResolvedValue({
    status: 'completed',
    output: [],
    output_text: JSON.stringify({
      ...base,
      questionComplete: true,
      evidenceConflict: true,
      projectClaims: [],
    }),
  });
  const result = await createRecommender('test', 'test-model')(
    { ...input, level: 'QUICK' },
    new AbortController().signal,
  );
  expect(result.missingInformation).toContain('The supplied evidence conflicts.');
  expect(create).toHaveBeenCalledOnce();
});

it('accepts a reviewed short clarification without padding', async () => {
  const candidate = {
    ...base,
    responseType: 'clarification',
    questionComplete: true,
    evidenceConflict: false,
    projectClaims: [],
    suggestedResponse: 'Which option?',
  };
  create
    .mockResolvedValueOnce({
      status: 'completed',
      output: [],
      output_text: JSON.stringify(candidate),
    })
    .mockResolvedValueOnce({
      status: 'completed',
      output: [],
      output_text: JSON.stringify({
        supported: true,
        issues: [],
        assessments: [
          {
            sentenceId: 0,
            kind: 'NONFACTUAL',
            factIds: [],
            explanation: 'Clarification',
            supported: true,
          },
        ],
      }),
    });
  const result = await createRecommender('test', 'test-model')(
    { ...input, level: 'QUICK' },
    new AbortController().signal,
  );
  expect(result.suggestedResponse).toBe('Which option?');
  expect(create).toHaveBeenCalledTimes(2);
});
it('returns clarification when manual generation skips usable ambiguous input', async () => {
  create.mockResolvedValue({
    status: 'completed',
    output: [],
    output_text: JSON.stringify({
      ...base,
      action: 'skip',
      responseType: 'none',
      category: 'none',
      topicKey: '',
      recommendation: '',
      suggestedResponse: '',
      groundedFactIds: [],
      triggerSegmentIds: [],
      missingInformation: ['Unclear referent'],
      questionComplete: false,
      evidenceConflict: false,
      projectClaims: [],
    }),
  });
  const result = await createRecommender('test', 'test-model')(
    {
      ...input,
      mode: 'manual',
      level: 'QUICK',
      question: 'Which one?',
      segments: [{ id: 's1', sequence: 0, text: 'Which one?', at: 0, final: true }],
    },
    new AbortController().signal,
  );
  expect(result.action).toBe('suggest');
  expect(result.responseType).toBe('clarification');
  expect(result.triggerSegmentIds).toEqual(['s1']);
});

it('does not turn missing pilot results into claims about whether the pilot occurred', async () => {
  create.mockResolvedValue({
    status: 'completed',
    output: [],
    output_text: JSON.stringify({
      ...base,
      questionComplete: true,
      evidenceConflict: false,
      projectClaims: [],
      missingInformation: ['Pilot results'],
      suggestedResponse:
        'We have not conducted a pilot yet, so there are no accuracy results to report.',
    }),
  });
  const result = await createRecommender('test', 'test-model')(
    { ...input, level: 'QUICK' },
    new AbortController().signal,
  );
  expect(ALL_FALLBACKS).toContain(result.suggestedResponse);
  expect(result.groundedFactIds).toEqual([]);
});

it('keeps an acknowledgment the model marked as "none" instead of failing with INVALID_OUTPUT', async () => {
  create.mockResolvedValue({
    status: 'completed',
    output: [],
    output_text: JSON.stringify({
      ...base,
      responseType: 'none',
      category: 'none',
      recommendation: '',
      suggestedResponse: 'Thank you for aiming to meet the timeline. Please reach out anytime.',
    }),
  });
  const result = await createRecommender('test', 'test-model')(
    { ...input, mode: 'manual' },
    new AbortController().signal,
  );
  expect(result.suggestedResponse).toBe(
    'Thank you for aiming to meet the timeline. Please reach out anytime.',
  );
  expect(result.responseType).toBe('answer');
  expect(result.category).toBe('question');
  expect(result.recommendation).toContain('Acknowledge');
});
