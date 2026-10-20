import { TRANSCRIPTION_MODEL, aiSetupProblem, answerModelFor, type Settings } from '@noclue/shared';
import type { HubConfig } from './hub.js';
import { createProviderRecommender } from './recommendations/provider.js';
import { OpenAITranscriber } from './realtime/transcriber.js';

/** Hub configuration from the user's stored settings (their own API keys). */
export function hubConfigFromSettings(settings: Settings, debug = false): HubConfig {
  const problem = aiSetupProblem(settings);
  const model = answerModelFor(settings);
  const answerKey =
    settings.answerProvider === 'anthropic' ? settings.anthropicKey : settings.openaiKey;
  return {
    model,
    configured: !problem,
    setupProblem: problem,
    debug,
    recommend: createProviderRecommender(settings.answerProvider, answerKey || 'missing', model),
    transcriber: (project, onSegment, onError) =>
      new OpenAITranscriber(settings.openaiKey, TRANSCRIPTION_MODEL, project, onSegment, onError),
  };
}
