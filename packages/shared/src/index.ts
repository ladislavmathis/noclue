import { z } from 'zod';

/** Single app version shown in the UI. Must equal root package.json and the extension manifest (enforced by tests/version.test.ts). */
export const APP_VERSION = '0.5.0';
export const PROTOCOL_VERSION = 5;
export const PROMPT_VERSION = 'quick-b2-v05.0-languages';
export const ClaimStatusSchema = z.enum([
  'PROPOSED',
  'PLANNED',
  'IMPLEMENTED',
  'TESTED',
  'VALIDATED',
]);
export type ClaimStatus = z.infer<typeof ClaimStatusSchema>;
export type Fact = { id: string; text: string; source: string | null; status: ClaimStatus | null };
export type QuestionState = {
  id: string;
  revision: number;
  text: string;
  segmentIds: string[];
  state:
    | 'LISTENING'
    | 'QUESTION_FORMING'
    | 'QUESTION_LIKELY_COMPLETE'
    | 'QUESTION_COMPLETE'
    | 'ANSWERING'
    | 'FAILED'
    | 'SKIPPED'
    | 'CANCELLED';
  reason?: string;
  speechStartedAt?: number;
  questionEndedAt?: number;
};
export type Feedback = 'helpful' | 'unhelpful' | 'slow' | 'long' | 'wrong';
export type TimelineEvent = {
  at: number;
  kind: string;
  sessionId: string;
  questionId?: string;
  revision?: number;
  requestId?: string;
  question?: string;
  answer?: string;
  model?: string;
  promptVersion?: string;
  facts?: Fact[];
  claims?: { factId: string; status: ClaimStatus | null }[];
  reason?: string;
  sourceAt?: number;
  surface?: string;
  clockUncertaintyMs?: number;
  feedback?: Feedback;
  segmentId?: string;
  commitSequence?: number;
  factsAvailable?: number;
  factsCited?: number;
};
export type TestLog = {
  version: 2;
  startedAt: number;
  endedAt?: number;
  events: TimelineEvent[];
  truncated: boolean;
};

export const LIMITS = {
  contextChars: 20_000,
  aboutMeChars: 5_000,
  transcriptChars: 12_000,
  transcriptMs: 300_000,
  debounceMs: 800,
  analysisMs: 5_000,
  displayMs: 12_000,
  duplicateMs: 60_000,
  requestMs: 25_000,
  /** Speech resuming sooner than this after an unanswered question continues it. */
  continuationMs: 1_500,
  /** Silence after which a final question that only looks unfinished is treated as complete. */
  trailingSettleMs: 2_000,
  /** Minimum spacing of speculative answers over a question that is still being spoken. */
  speculationMs: 2_000,
  audioQueueBytes: 96_000,
} as const;
export const ProjectSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    aboutMe: z.string().trim().max(LIMITS.aboutMeChars).optional(),
    role: z.string().trim().max(500),
    goal: z.string().trim().max(1500),
    context: z.string().trim().min(1).max(LIMITS.contextChars),
    keywords: z
      .array(
        z
          .string()
          .trim()
          .min(1)
          .max(80)
          .regex(/^[^<>\r\n]+$/),
      )
      .max(40),
    preferences: z
      .object({
        tone: z.enum(['casual', 'professional', 'executive']),
        length: z.enum(['brief', 'standard', 'detailed']),
        strictContext: z.boolean(),
        silenceMs: z.number().int().min(300).max(2000),
        previewUnverified: z.boolean().optional(),
        /** Language spoken in the meeting; answers are prepared in it. */
        language: z.enum(['en', 'sk', 'cs', 'de', 'auto']).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type Project = z.infer<typeof ProjectSchema>;
export const defaultPreferences = {
  tone: 'professional',
  length: 'standard',
  strictContext: false,
  silenceMs: 700,
  previewUnverified: true,
  language: 'en',
} as const;
/** Meeting languages noclue transcribes and answers in. 'auto' answers in the question's language. */
export const MEETING_LANGUAGES = ['en', 'sk', 'cs', 'de', 'auto'] as const;
export type MeetingLanguage = (typeof MEETING_LANGUAGES)[number];
export type SpokenLanguage = Exclude<MeetingLanguage, 'auto'>;
export const SPOKEN_LANGUAGES: readonly SpokenLanguage[] = ['en', 'sk', 'cs', 'de'];
export const MEETING_LANGUAGE_LABELS: Record<MeetingLanguage, string> = {
  en: 'English',
  sk: 'Slovak',
  cs: 'Czech',
  de: 'German',
  auto: 'Automatic (same as the question)',
};
/** The meeting language of a project, defaulting to English for settings saved before 0.5. */
export const meetingLanguage = (project: Pick<Project, 'preferences'>): MeetingLanguage =>
  project.preferences?.language ?? 'en';
/** English name of a fixed meeting language, or null for automatic detection. */
export const languageName = (language: MeetingLanguage): string | null =>
  language === 'auto' ? null : MEETING_LANGUAGE_LABELS[language];
/**
 * Bring-your-own-key AI configuration. Transcription always uses OpenAI (no other provider
 * offers comparable realtime speech-to-text); answers and the fact check use the chosen
 * provider. Keys live only in chrome.storage.local on this device.
 */
export const OPENAI_ANSWER_MODELS = ['gpt-4.1-mini', 'gpt-4.1'] as const;
export const ANTHROPIC_ANSWER_MODELS = [
  'claude-opus-5-5',
  'claude-sonnet-5-5',
  'claude-haiku-5-5',
] as const;
export const TRANSCRIPTION_MODEL = 'gpt-live-transcribe';
export const AnswerProviderSchema = z.enum(['openai', 'anthropic']);
export type AnswerProvider = z.infer<typeof AnswerProviderSchema>;
export const defaultAnswerModel = (provider: AnswerProvider) =>
  provider === 'anthropic' ? ANTHROPIC_ANSWER_MODELS[0] : OPENAI_ANSWER_MODELS[0];
/** OpenAI keys start with sk-; Anthropic keys with sk-ant-. Whitespace from pasting is removed. */
export const normalizeKey = (key: string) => key.replace(/\s+/g, '');
export const looksLikeOpenAIKey = (key: string) =>
  /^sk-[A-Za-z0-9_-]{20,}$/.test(key) && !key.startsWith('sk-ant-');
export const looksLikeAnthropicKey = (key: string) => /^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key);
export const SettingsSchema = z.object({
  testMode: z.boolean().optional(),
  openaiKey: z.string().max(512).default(''),
  anthropicKey: z.string().max(512).default(''),
  answerProvider: AnswerProviderSchema.default('openai'),
  answerModel: z.string().max(100).default(''),
  /** Set once the user has accepted the data-flow notice in the setup guide. */
  consentAt: z.number().int().nonnegative().optional(),
  microphoneId: z.string().max(512),
  project: ProjectSchema,
});
export type Settings = z.infer<typeof SettingsSchema>;
/** The answer model actually used, falling back to the provider default. */
export function answerModelFor(settings: Pick<Settings, 'answerProvider' | 'answerModel'>) {
  const allowed: readonly string[] =
    settings.answerProvider === 'anthropic' ? ANTHROPIC_ANSWER_MODELS : OPENAI_ANSWER_MODELS;
  return allowed.includes(settings.answerModel)
    ? settings.answerModel
    : defaultAnswerModel(settings.answerProvider);
}
/** Missing configuration in plain words, or undefined when ready. */
export function aiSetupProblem(settings: Settings): string | undefined {
  if (!settings.openaiKey) return 'Add your OpenAI API key. It is needed for live transcription.';
  if (settings.answerProvider === 'anthropic' && !settings.anthropicKey)
    return 'Add your Anthropic API key, or choose OpenAI for answers.';
}
export const emptyProject: Project = { name: '', role: '', goal: '', context: '', keywords: [] };
export const DecisionSchema = z
  .object({
    action: z
      .enum(['suggest', 'skip'])
      .describe(
        'Suggest for a substantive question, including missing facts in strict mode (state the information gap). Skip only when addressed to someone else in automatic mode, repeated/irrelevant chatter, or no usable transcript.',
      ),
    responseType: z.enum(['answer', 'draft', 'clarification', 'none']),
    category: z.enum(['question', 'objection', 'opportunity', 'none']),
    triggerSegmentIds: z.array(z.string()).max(50),
    topicKey: z.string().max(120),
    recommendation: z.string().max(800),
    suggestedResponse: z.string().max(2000),
    groundedFactIds: z.array(z.string()).max(100),
    missingInformation: z.array(z.string().max(500)).max(20),
  })
  .strict();
export type Decision = z.infer<typeof DecisionSchema>;
export const QuickDecisionSchema = DecisionSchema.extend({
  questionComplete: z.boolean(),
  evidenceConflict: z.boolean(),
  projectClaims: z
    .array(z.object({ factId: z.string(), status: ClaimStatusSchema.nullable() }).strict())
    .max(30),
}).strict();
export type QuickDecision = z.infer<typeof QuickDecisionSchema>;
export type Segment = { id: string; sequence: number; text: string; at: number; final: boolean };
export type Suggestion = Decision & {
  requestId: string;
  at: number;
  mode: 'automatic' | 'manual';
  questionId?: string;
  revision?: number;
  question?: string;
  level?: 'QUICK' | 'STANDARD' | 'DEEP_DIVE';
  projectClaims?: QuickDecision['projectClaims'];
  questionEndedAt?: number;
  answerBasis?: 'direct' | 'synthesis' | 'partial' | 'insufficient' | 'general';
};
export const ClientMessageSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('meeting_speech.changed'),
      sessionId: z.string().uuid(),
      speaking: z.boolean(),
      at: z.number().finite().nonnegative(),
      speechAt: z.number().finite().nonnegative(),
    })
    .strict(),
  z.object({ type: z.literal('clock.sync'), sentAt: z.number().finite() }).strict(),
  z.object({ type: z.literal('connection.check') }).strict(),
  z
    .object({
      type: z.literal('context.preview'),
      project: ProjectSchema,
      question: z.string().trim().min(1).max(2000),
    })
    .strict(),
  z
    .object({
      type: z.literal('authenticate'),
      /** Unused since 0.4: the hub runs inside the extension, there is nothing to pair. */
      token: z.string().max(256).optional(),
      protocolVersion: z.number().int().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('session.start'),
      sessionId: z.string().uuid(),
      project: ProjectSchema,
      micAvailable: z.boolean(),
      testMode: z.boolean().optional(),
    })
    .strict(),
  z.object({ type: z.literal('audio.commit'), sessionId: z.string().uuid() }).strict(),
  z
    .object({
      type: z.literal('self_speech.changed'),
      sessionId: z.string().uuid(),
      speaking: z.boolean(),
      available: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal('recommendation.request'),
      sessionId: z.string().uuid(),
      questionId: z.string().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('recommendation.dismiss'),
      sessionId: z.string().uuid(),
      requestId: z.string(),
    })
    .strict(),
  z.object({ type: z.literal('session.stop'), sessionId: z.string().uuid() }).strict(),
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;
export type ServerEvent =
  | { type: 'authenticated'; protocolVersion?: number }
  | { type: 'clock.synced'; sentAt: number; serverAt: number }
  | { type: 'question.updated'; sessionId: string; question: QuestionState }
  | { type: 'telemetry.event'; sessionId: string; event: TimelineEvent }
  | { type: 'connection.checked' }
  | { type: 'context.preview.ready'; decision: Decision }
  | { type: 'session.ready'; sessionId: string }
  | { type: 'transcript.delta' | 'transcript.final'; sessionId: string; segment: Segment }
  | {
      type: 'recommendation.started';
      sessionId: string;
      requestId: string;
      mode: 'automatic' | 'manual';
      questionId?: string;
      revision?: number;
    }
  | { type: 'recommendation.ready'; sessionId: string; suggestion: Suggestion }
  | {
      type: 'recommendation.preview';
      sessionId: string;
      preview: AnswerPreview;
    }
  | {
      type: 'recommendation.finished';
      sessionId: string;
      requestId: string;
      reason: string;
      questionId?: string;
      revision?: number;
    }
  | { type: 'session.status'; sessionId: string; message: string }
  | {
      type: 'session.error';
      sessionId?: string;
      questionId?: string;
      revision?: number;
      requestId?: string;
      code: string;
      message: string;
      fatal: boolean;
      retryable: boolean;
      retryAfterMs?: number;
    }
  | { type: 'session.stopped'; sessionId: string };
/** First candidate shown while the evidence review is still running. Never treated as a final suggestion. */
export type AnswerPreview = {
  requestId: string;
  questionId: string;
  revision: number;
  suggestedResponse: string;
  recommendation: string;
  responseType: Decision['responseType'];
};
export type PanelState = {
  sessionId?: string;
  question?: QuestionState;
  testMode?: boolean;
  testLogCount?: number;
  testLogTruncated?: boolean;
  quickLatencyMs?: number;
  tabId?: number;
  status:
    | 'Ready'
    | 'Connecting'
    | 'Listening'
    | 'You are speaking'
    | 'Reconnecting'
    | 'Stopped'
    | 'Error';
  active: boolean;
  speaking: boolean;
  micAvailable: boolean;
  generating: boolean;
  currentRequestId?: string;
  generatingMode?: 'automatic' | 'manual';
  meetingLevel: number;
  micLevel: number;
  message: string;
  segments: Segment[];
  transcriptHistory?: Segment[];
  transcriptTruncated?: boolean;
  suggestions: Suggestion[];
  preview?: AnswerPreview;
  /** The newest suggestion was dismissed; older ones stay history until the next answer. */
  cueDismissed?: boolean;
  projectName?: string;
};
/**
 * What the cue window and panel show as the live cue: the newest checked answer stays
 * visible after its question ends, until a newer answer or that answer's draft replaces it.
 */
export function visibleCue(state: PanelState): { cue?: Suggestion; preview?: AnswerPreview } {
  if (!state.active) return {};
  const preview =
    state.preview &&
    state.preview.requestId === state.currentRequestId &&
    state.preview.questionId === state.question?.id &&
    state.preview.revision === state.question?.revision
      ? state.preview
      : undefined;
  if (preview) return { preview };
  return { cue: state.cueDismissed ? undefined : state.suggestions[0] };
}
export const initialState = (): PanelState => ({
  status: 'Ready',
  active: false,
  speaking: false,
  micAvailable: false,
  generating: false,
  meetingLevel: 0,
  micLevel: 0,
  message: '',
  segments: [],
  transcriptHistory: [],
  transcriptTruncated: false,
  suggestions: [],
});
export type ExtensionCommand =
  | { target: 'offscreen'; type: 'test.export' | 'test.clear' }
  | {
      target: 'offscreen';
      type: 'answer.visible';
      sessionId: string;
      requestId: string;
      at: number;
      surface: 'panel' | 'overlay';
    }
  | { target: 'offscreen'; type: 'feedback'; requestId: string; feedback: Feedback }
  | { target: 'background'; type: 'start'; settings: Settings }
  | { target: 'background'; type: 'setup' }
  | { target: 'background'; type: 'guide' }
  | { target: 'background'; type: 'overlay' }
  | { target: 'offscreen'; type: 'start'; settings: Settings; streamId: string; tabId: number }
  | { target: 'offscreen'; type: 'stop' | 'snapshot' }
  | { target: 'offscreen'; type: 'answer'; questionId?: string }
  | { target: 'offscreen'; type: 'dismiss'; requestId: string };

// Stable IDs survive reordering unrelated paragraphs. No text is sent to a hashing service.
export function factsFromContext(context: string): Fact[] {
  return [
    ...new Set(
      context
        .split(/\n\s*\n/)
        .map((x) => x.trim())
        .filter(Boolean),
    ),
  ].map((text) => {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
    const annotation = text.match(
      /^\[CLAIM (PROPOSED|PLANNED|IMPLEMENTED|TESTED|VALIDATED) \| ([^\]\n]+)\]\s*\n/,
    );
    return {
      id: `fact-${(hash >>> 0).toString(16)}`,
      text: annotation ? text.slice(annotation[0].length) : text,
      status: annotation ? (annotation[1] as ClaimStatus) : null,
      source: annotation?.[2] ?? null,
    };
  });
}
export function factsForProject(project: Project): Fact[] {
  return [
    ...factsFromContext(project.context),
    ...factsFromContext(project.aboutMe ?? '').map((fact) => ({
      ...fact,
      id: `personal-${fact.id}`,
    })),
  ];
}

export function pruneSegments(segments: Segment[], now = Date.now()): Segment[] {
  const sorted = segments
    .filter((s) => s.at >= now - LIMITS.transcriptMs)
    .sort((a, b) => a.sequence - b.sequence);
  let chars = sorted.reduce((sum, s) => sum + s.text.length, 0);
  while (chars > LIMITS.transcriptChars && sorted.length) chars -= sorted.shift()!.text.length;
  return sorted;
}

// UI history is separate from the small AI context. Never persisted to disk.
export function appendTranscript(history: Segment[], segment: Segment) {
  const previous = history.find((s) => s.id === segment.id);
  if (previous?.final) return { segments: history, truncated: false };
  const segments = [...history.filter((s) => s.id !== segment.id), segment].sort(
    (a, b) => a.sequence - b.sequence,
  );
  let chars = segments.reduce((sum, s) => sum + s.text.length, 0),
    truncated = false;
  while (chars > 500_000 || segments.length > 10_000) {
    chars -= segments.shift()!.text.length;
    truncated = true;
  }
  return { segments, truncated };
}

/** Browser meeting pages the extension can capture: the tab audio carries the other participants. */
export const MEETING_PLATFORMS: { name: string; hosts: readonly string[] }[] = [
  { name: 'Google Meet', hosts: ['meet.google.com'] },
  {
    name: 'Microsoft Teams',
    hosts: ['teams.microsoft.com', 'teams.cloud.microsoft', 'teams.live.com'],
  },
];
/** Platform name for a tab URL, or undefined when the tab is not a supported meeting page. */
export function meetingPlatform(url: string | undefined): string | undefined {
  if (!url) return undefined;
  let host: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return undefined;
    host = parsed.hostname.toLowerCase();
  } catch {
    return undefined;
  }
  return MEETING_PLATFORMS.find((platform) =>
    platform.hosts.some((h) => host === h || host.endsWith(`.${h}`)),
  )?.name;
}
