import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import Anthropic from '@anthropic-ai/sdk';
import { jsonSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/json-schema';
import type { ZodTypeAny } from 'zod';
import { LIMITS } from '@noclue/shared';
import type { ProviderName } from './errors.js';

/**
 * One structured-output call. Answer generation and the evidence review both send
 * instructions + a JSON data payload and expect JSON matching a Zod schema; the caller
 * validates the returned JSON against that schema.
 */
export type StructuredRequest = {
  schema: ZodTypeAny;
  name: string;
  instructions: string;
  input: string;
  maxTokens: number;
};
export type StructuredResult =
  { ok: true; json: unknown } | { ok: false; reason: 'incomplete' | 'refusal' | 'invalid' };
export interface StructuredModel {
  readonly provider: ProviderName;
  readonly model: string;
  /** Network and HTTP failures throw the SDK error; map it with safeError(error, provider). */
  complete(request: StructuredRequest, signal: AbortSignal): Promise<StructuredResult>;
}

function parseJson(text: string): StructuredResult {
  try {
    return { ok: true, json: JSON.parse(text) };
  } catch {
    return { ok: false, reason: 'invalid' };
  }
}

/** OpenAI Responses API with strict JSON schema output. `store:false` opts out of response storage;
 * provider abuse-monitoring and account retention policies still apply. */
export function openAIModel(apiKey: string, model: string): StructuredModel {
  // The key is the user's own and stays in their browser; requests go straight to OpenAI.
  const client = new OpenAI({
    apiKey,
    maxRetries: 0,
    timeout: LIMITS.requestMs,
    dangerouslyAllowBrowser: true,
  });
  return {
    provider: 'OpenAI',
    model,
    async complete(request, signal) {
      const response = await client.responses.create(
        {
          model,
          store: false,
          max_output_tokens: request.maxTokens,
          instructions: request.instructions,
          input: request.input,
          text: { format: zodTextFormat(request.schema, request.name) },
        },
        { signal },
      );
      signal.throwIfAborted();
      if (response.status !== 'completed') return { ok: false, reason: 'incomplete' };
      if (
        response.output.some(
          (item) => item.type === 'message' && item.content.some((c) => c.type === 'refusal'),
        )
      )
        return { ok: false, reason: 'refusal' };
      return parseJson(response.output_text);
    },
  };
}

/** Server-side refusal fallback ("default" routing) is available for these models. */
const FALLBACK_MODELS = new Set<string>(['claude-opus-5-5', 'claude-sonnet-5-5']);
/**
 * Thinking is always on for current Claude models and counts toward max_tokens. Low effort
 * keeps a live meeting answer fast; the extra budget prevents a truncated JSON answer.
 */
const THINKING_HEADROOM = 4000;

/** Anthropic Messages API with JSON schema output, called directly from the browser. */
export function anthropicModel(apiKey: string, model: string): StructuredModel {
  const client = new Anthropic({
    apiKey,
    maxRetries: 0,
    timeout: LIMITS.requestMs,
    // Bring-your-own-key extension: the key never leaves the user's browser except to
    // api.anthropic.com. The SDK adds the required direct-browser-access header.
    dangerouslyAllowBrowser: true,
  });
  const formats = new WeakMap<
    ZodTypeAny,
    { type: 'json_schema'; schema: Record<string, unknown> }
  >();
  const formatFor = (request: StructuredRequest) => {
    let format = formats.get(request.schema);
    if (!format) {
      // Reuse the OpenAI helper to turn the (Zod v3) schema into JSON schema, then let the
      // Anthropic SDK move constraints it cannot enforce (maxLength, maxItems) into
      // descriptions. The caller still validates the full Zod schema.
      const { schema } = jsonSchemaOutputFormat(
        zodTextFormat(request.schema, request.name).schema as any,
      );
      format = { type: 'json_schema', schema };
      formats.set(request.schema, format);
    }
    return format;
  };
  return {
    provider: 'Anthropic',
    model,
    async complete(request, signal) {
      const response = await client.beta.messages.create(
        {
          model,
          max_tokens: request.maxTokens + THINKING_HEADROOM,
          system: [
            {
              type: 'text',
              text: request.instructions,
              // Instructions repeat for every question in a meeting; a cache hit makes
              // repeated calls cheaper when the prefix is long enough to be cached.
              cache_control: { type: 'ephemeral' },
            },
          ],
          messages: [{ role: 'user', content: request.input }],
          output_config: { effort: 'low', format: formatFor(request) },
          ...(FALLBACK_MODELS.has(model)
            ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }
            : {}),
        } as Anthropic.Beta.Messages.MessageCreateParamsNonStreaming,
        { signal },
      );
      signal.throwIfAborted();
      if (response.stop_reason === 'refusal') return { ok: false, reason: 'refusal' };
      if (response.stop_reason === 'max_tokens') return { ok: false, reason: 'incomplete' };
      const text = response.content
        .flatMap((block) => (block.type === 'text' ? [block.text] : []))
        .join('');
      return text ? parseJson(text) : { ok: false, reason: 'incomplete' };
    },
  };
}
