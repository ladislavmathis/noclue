import { describe, expect, it, vi } from 'vitest';
const models = vi.hoisted(() => ({ openai: vi.fn(), anthropic: vi.fn() }));
vi.mock('openai', () => ({
  default: class {
    models = { retrieve: models.openai };
  },
}));
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    models = { retrieve: models.anthropic };
  },
}));
vi.stubGlobal('chrome', { storage: { local: {} } });
import {
  SettingsSchema,
  aiSetupProblem,
  answerModelFor,
  looksLikeAnthropicKey,
  looksLikeOpenAIKey,
  normalizeKey,
  emptyProject,
} from '@noclue/shared';
import { verifyKeys } from '../packages/core/src/keys';
import { withDefaults } from '../apps/extension/src/ui/settings';

const base = SettingsSchema.parse({
  microphoneId: '',
  project: { ...emptyProject, name: 'Test', context: 'Facts.' },
});

describe('BYOK settings', () => {
  it('migrates 0.3 settings: drops the pairing token and defaults the AI fields', () => {
    const migrated = withDefaults({
      token: 't'.repeat(64),
      microphoneId: 'mic',
      project: { ...emptyProject, name: 'Old' },
    });
    expect(migrated).not.toHaveProperty('token');
    expect(migrated).toMatchObject({
      openaiKey: '',
      anthropicKey: '',
      answerProvider: 'openai',
      microphoneId: 'mic',
    });
    expect(migrated.project.name).toBe('Old');
  });
  it('explains what is missing in plain words', () => {
    expect(aiSetupProblem(base)).toContain('OpenAI API key');
    expect(aiSetupProblem({ ...base, openaiKey: 'sk-x' })).toBeUndefined();
    expect(aiSetupProblem({ ...base, openaiKey: 'sk-x', answerProvider: 'anthropic' })).toContain(
      'Anthropic API key',
    );
  });
  it('falls back to the provider default model for unknown or mismatched models', () => {
    expect(answerModelFor({ answerProvider: 'openai', answerModel: '' })).toBe('gpt-4.1-mini');
    expect(answerModelFor({ answerProvider: 'anthropic', answerModel: 'gpt-4.1' })).toBe(
      'claude-opus-5-5',
    );
    expect(answerModelFor({ answerProvider: 'anthropic', answerModel: 'claude-haiku-5-5' })).toBe(
      'claude-haiku-5-5',
    );
  });
  it('recognises key formats and removes pasted whitespace', () => {
    expect(normalizeKey(' sk-proj-abc\n def ')).toBe('sk-proj-abcdef');
    expect(looksLikeOpenAIKey('sk-proj-' + 'a'.repeat(30))).toBe(true);
    expect(looksLikeOpenAIKey('sk-ant-' + 'a'.repeat(30))).toBe(false);
    expect(looksLikeAnthropicKey('sk-ant-api03-' + 'a'.repeat(30))).toBe(true);
    expect(looksLikeAnthropicKey('sk-proj-' + 'a'.repeat(30))).toBe(false);
  });
});

describe('free key test', () => {
  it('checks the transcription model and the answer model without generating anything', async () => {
    models.openai.mockReset().mockResolvedValue({});
    const result = await verifyKeys({ ...base, openaiKey: 'sk-test' });
    expect(models.openai.mock.calls.map((c) => c[0])).toEqual([
      'gpt-live-transcribe',
      'gpt-4.1-mini',
    ]);
    expect(result.every((r) => r.ok)).toBe(true);
  });
  it('reports a rejected key, missing model access and network problems calmly', async () => {
    models.openai.mockReset().mockRejectedValueOnce({ status: 401 }).mockResolvedValue({});
    models.anthropic.mockReset().mockRejectedValueOnce({ status: 404 });
    const result = await verifyKeys({
      ...base,
      openaiKey: 'sk-test',
      anthropicKey: 'sk-ant-test',
      answerProvider: 'anthropic',
    });
    expect(models.openai).toHaveBeenCalledTimes(1);
    expect(result[0]).toMatchObject({ provider: 'OpenAI', ok: false });
    expect(result[0].message).toContain('did not accept this key');
    expect(result[1]).toMatchObject({ provider: 'Anthropic', ok: false });
    expect(result[1].message).toContain('cannot use claude-opus-5-5');
    models.openai.mockReset().mockRejectedValue(new TypeError('Failed to fetch'));
    const offline = await verifyKeys({ ...base, openaiKey: 'sk-test' });
    expect(offline[0].message).toContain('Could not reach OpenAI');
    for (const r of [...result, ...offline]) expect(r.message).not.toMatch(/!/);
  });
});
