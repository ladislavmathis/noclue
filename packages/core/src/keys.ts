import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { TRANSCRIPTION_MODEL, answerModelFor, type Settings } from '@noclue/shared';

export type KeyCheck = { provider: 'OpenAI' | 'Anthropic'; ok: boolean; message: string };

/**
 * Free key test: reading one model's metadata needs a valid key with access to that
 * model, but generates nothing and is not billed. Messages are short and calm.
 */
async function check(
  provider: KeyCheck['provider'],
  model: string,
  retrieve: () => Promise<unknown>,
): Promise<KeyCheck> {
  try {
    await retrieve();
    return { provider, ok: true, message: `${provider} key works. ${model} is available.` };
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 401)
      return {
        provider,
        ok: false,
        message: `${provider} did not accept this key. Copy it again from your ${provider} account.`,
      };
    if (status === 403 || status === 404)
      return {
        provider,
        ok: false,
        message: `This key cannot use ${model} yet. Check model access and billing in your ${provider} account.`,
      };
    if (status === 429)
      return {
        provider,
        ok: false,
        message: `${provider} is limiting requests right now. Try again in a minute.`,
      };
    return {
      provider,
      ok: false,
      message: `Could not reach ${provider}. Check your internet connection and try again.`,
    };
  }
}

export async function verifyKeys(settings: Settings, signal?: AbortSignal): Promise<KeyCheck[]> {
  const results: Promise<KeyCheck>[] = [];
  if (settings.openaiKey) {
    const openai = new OpenAI({
      apiKey: settings.openaiKey,
      maxRetries: 0,
      timeout: 15000,
      dangerouslyAllowBrowser: true,
    });
    results.push(
      check('OpenAI', TRANSCRIPTION_MODEL, () =>
        openai.models.retrieve(TRANSCRIPTION_MODEL, { signal }),
      ),
    );
    if (settings.answerProvider === 'openai') {
      const model = answerModelFor(settings);
      results.push(check('OpenAI', model, () => openai.models.retrieve(model, { signal })));
    }
  }
  if (settings.answerProvider === 'anthropic' && settings.anthropicKey) {
    const anthropic = new Anthropic({
      apiKey: settings.anthropicKey,
      maxRetries: 0,
      timeout: 15000,
      dangerouslyAllowBrowser: true,
    });
    const model = answerModelFor(settings);
    results.push(check('Anthropic', model, () => anthropic.models.retrieve(model, {}, { signal })));
  }
  return Promise.all(results);
}
