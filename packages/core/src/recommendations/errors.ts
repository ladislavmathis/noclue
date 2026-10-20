// Provider-neutral error type and mapping. HTTP-shaped errors from both the OpenAI and
// the Anthropic SDK expose status, headers and an error code/type, so one mapping serves both.
// Messages follow the noclue tone: short, calm, one next step, no blame.
export type ProviderName = 'OpenAI' | 'Anthropic';
export class ProviderError extends Error {
  constructor(
    public code: string,
    message: string,
    public retryable = false,
    public retryAfterMs?: number,
  ) {
    super(message);
  }
}
type HttpLikeError = {
  status?: number;
  headers?: Headers;
  code?: string;
  type?: string;
  name?: string;
  message?: string;
  /** Anthropic SDK: parsed response body, `{ type: 'error', error: { type, message } }`. */
  error?: { type?: string; message?: string; error?: { type?: string; message?: string } };
};
function retryAfterMs(headers?: Headers): number {
  const retry = headers?.get?.('retry-after');
  const ms = retry
    ? /^\d+(\.\d+)?$/.test(retry)
      ? Number(retry) * 1000
      : Math.max(0, Date.parse(retry) - Date.now())
    : 5000;
  return Number.isFinite(ms) ? ms : 5000;
}
export function safeError(error: unknown, provider: ProviderName = 'OpenAI'): ProviderError {
  if (error instanceof ProviderError) return error;
  const e = error as HttpLikeError;
  if (
    e?.name === 'TimeoutError' ||
    e?.name === 'AbortError' ||
    e?.code === 'ETIMEDOUT' ||
    e?.message === 'timeout'
  )
    return new ProviderError('TIMEOUT', 'AI response timed out. Try Answer Now.', true);
  const anthropicType = e?.error?.error?.type ?? e?.error?.type;
  const billing =
    billingError(e?.code, e?.type, provider) ??
    anthropicBilling(e?.status, anthropicType, e?.error?.error?.message ?? e?.message);
  if (billing) return billing;
  if (e?.status === 401 || e?.status === 403)
    return new ProviderError(
      'API_ACCESS',
      `${provider} access denied. Check your API key and model access.`,
    );
  if (e?.status === 429)
    return new ProviderError(
      'RATE_LIMIT',
      `${provider} rate limit reached. Please wait before retrying.`,
      true,
      retryAfterMs(e.headers),
    );
  if (e?.status === 400 || e?.status === 404)
    return new ProviderError(
      'MODEL_CONFIGURATION',
      `${provider} rejected the model or session configuration. Check model access and settings.`,
    );
  // Anthropic 529 (overloaded) and every 5xx: temporary, worth retrying.
  return new ProviderError(
    'PROVIDER_UNAVAILABLE',
    'AI service unavailable. Check your connection and try again.',
    true,
  );
}
export function billingError(
  code?: string,
  type?: string,
  provider: ProviderName = 'OpenAI',
): ProviderError | undefined {
  if (code === 'credit_balance_exhausted')
    return new ProviderError(
      'API_BILLING',
      `${provider} API credits are exhausted. Add credits in ${provider} billing, then run Check again.`,
    );
  if (
    type === 'insufficient_quota' ||
    code === 'insufficient_quota' ||
    [
      'organization_spend_limit_exceeded',
      'project_spend_limit_exceeded',
      'organization_usage_limit_exceeded',
    ].includes(code ?? '')
  )
    return new ProviderError(
      'API_BILLING',
      `${provider} API billing or usage limit reached. Check credits and limits in ${provider} settings, then run Check again.`,
    );
}
/** Anthropic reports an empty balance as a 400 whose message mentions the credit balance. */
function anthropicBilling(
  status?: number,
  type?: string,
  message?: string,
): ProviderError | undefined {
  if (status === 400 && type === 'invalid_request_error' && /credit balance/i.test(message ?? ''))
    return new ProviderError(
      'API_BILLING',
      'Anthropic API credits are exhausted. Add credits in Anthropic billing, then run Check again.',
    );
}
