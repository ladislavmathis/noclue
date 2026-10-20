import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { MeetingSession } from '../packages/core/src/sessions/session';
import type { Recommend } from '../packages/core/src/recommendations/provider';
import {
  LIMITS,
  initialState,
  visibleCue,
  type Decision,
  type PanelState,
  type ServerEvent,
  type Suggestion,
} from '@noclue/shared';

const project = { name: 'Fictional', role: 'Lead', goal: 'Pilot', context: 'C', keywords: [] };
const decision: Decision = {
  action: 'suggest',
  responseType: 'answer',
  category: 'question',
  triggerSegmentIds: ['a'],
  topicKey: 'pilot',
  recommendation: 'Clarify the next step.',
  suggestedResponse: 'We can discuss the pilot scope.',
  groundedFactIds: [],
  missingInformation: [],
};
let events: ServerEvent[], s: MeetingSession;
const segment = (id: string, text: string, sequence: number, final = true) => ({
  id,
  sequence,
  text,
  at: Date.now(),
  final,
});

// Applies backend events the way offscreen/index.ts does for the fields visibleCue reads.
function panel(): PanelState {
  const state: PanelState = { ...initialState(), active: true };
  const valid = new Set<string>();
  let manual: string | undefined;
  for (const e of events) {
    if (e.type === 'question.updated') {
      if (state.question?.id !== e.question.id || state.question?.revision !== e.question.revision)
        valid.clear();
      state.question = e.question;
    } else if (e.type === 'recommendation.started') {
      if (e.mode === 'manual') manual = e.requestId;
      if (e.questionId !== state.question?.id || e.revision !== state.question?.revision) continue;
      valid.clear();
      valid.add(e.requestId);
      state.currentRequestId = e.requestId;
      state.preview = undefined;
      state.generating = true;
    } else if (e.type === 'recommendation.finished') {
      if (e.reason) {
        valid.delete(e.requestId);
        if (manual === e.requestId) manual = undefined;
        if (state.preview?.requestId === e.requestId) state.preview = undefined;
      }
      state.generating = false;
    } else if (e.type === 'recommendation.preview') {
      if (valid.has(e.preview.requestId) && e.preview.requestId === state.currentRequestId)
        state.preview = e.preview;
    } else if (e.type === 'recommendation.ready') {
      if (state.preview?.requestId === e.suggestion.requestId) state.preview = undefined;
      const isManual = e.suggestion.mode === 'manual' && e.suggestion.requestId === manual;
      if (!isManual && !valid.has(e.suggestion.requestId)) continue;
      if (isManual) manual = undefined;
      valid.delete(e.suggestion.requestId);
      state.suggestions = [e.suggestion, ...state.suggestions].slice(0, 3);
      state.cueDismissed = false;
    }
  }
  return state;
}
const shown = () => {
  const { cue, preview } = visibleCue(panel());
  return cue
    ? `answer:${cue.suggestedResponse}`
    : preview
      ? `preview:${preview.suggestedResponse}`
      : undefined;
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(100_000);
  events = [];
});
afterEach(() => {
  s.stop();
  vi.useRealTimers();
});

describe('cue stays visible until replaced', () => {
  it('keeps the answered cue while the next utterance starts a new question', async () => {
    s = new MeetingSession(
      't',
      project,
      true,
      async () => decision,
      (e) => events.push(e),
    );
    s.meetingSpeech(true, Date.now());
    s.transcript(segment('a', 'What about the pilot?', 1));
    s.meetingSpeech(false, Date.now());
    await vi.advanceTimersByTimeAsync(400);
    expect(shown()).toBe('answer:We can discuss the pilot scope.');
    s.meetingSpeech(true, Date.now());
    s.transcript(segment('b', 'Okay.', 2, false));
    expect(panel().question?.text).toBe('Okay.');
    expect(shown()).toBe('answer:We can discuss the pilot scope.');
  });

  it('replaces the previous cue with the next question’s answer', async () => {
    let n = 0;
    s = new MeetingSession(
      't',
      project,
      true,
      async () => ({ ...decision, suggestedResponse: `Answer ${++n}` }),
      (e) => events.push(e),
    );
    for (const [id, text, seq] of [
      ['a', 'What about the pilot?', 1],
      ['b', 'How long will it take?', 2],
    ] as const) {
      s.meetingSpeech(true, Date.now());
      s.transcript(segment(id, text, seq));
      s.meetingSpeech(false, Date.now());
      await vi.advanceTimersByTimeAsync(400);
    }
    expect(shown()).toBe('answer:Answer 2');
  });

  it('publishes the checked answer of a shown preview even if the speaker resumed meanwhile', async () => {
    let resolve!: (d: Decision) => void;
    const recommend: Recommend = (input) =>
      new Promise((r) => {
        input.onPreview?.(decision);
        resolve = r;
      });
    s = new MeetingSession('t', project, true, recommend, (e) => events.push(e));
    s.meetingSpeech(true, Date.now());
    s.transcript(segment('a', 'What about the pilot?', 1));
    s.meetingSpeech(false, Date.now());
    await vi.advanceTimersByTimeAsync(400);
    expect(shown()).toBe('preview:We can discuss the pilot scope.');
    s.meetingSpeech(true, Date.now()); // breath or echo: voice activity without new words
    resolve(decision);
    await vi.advanceTimersByTimeAsync(1);
    expect(shown()).toBe('answer:We can discuss the pilot scope.');
    s.transcript(segment('b', 'Right.', 2, false));
    expect(shown()).toBe('answer:We can discuss the pilot scope.');
  });

  it('withdraws a preview whose question changes before the check, falling back to the previous cue', async () => {
    let calls = 0;
    const recommend: Recommend = (input) => {
      if (++calls === 1) return Promise.resolve({ ...decision, suggestedResponse: 'First' });
      input.onPreview?.({ ...decision, suggestedResponse: 'Second draft' });
      return new Promise(() => {});
    };
    s = new MeetingSession('t', project, true, recommend, (e) => events.push(e));
    s.meetingSpeech(true, Date.now());
    s.transcript(segment('a', 'What about the pilot?', 1));
    s.meetingSpeech(false, Date.now());
    await vi.advanceTimersByTimeAsync(400);
    s.meetingSpeech(true, Date.now());
    s.transcript(segment('b', 'How long will it take?', 2));
    s.meetingSpeech(false, Date.now());
    await vi.advanceTimersByTimeAsync(400);
    expect(shown()).toBe('preview:Second draft');
    s.transcript(segment('c', 'How long will it take for the rollout?', 2));
    expect(shown()).toBe('answer:First');
  });
});

it('finishes a previewed answer when the user starts speaking (reading the draft aloud)', async () => {
  let resolve!: (d: Decision) => void;
  const recommend: Recommend = (input) =>
    new Promise((r) => {
      input.onPreview?.(decision);
      resolve = r;
    });
  s = new MeetingSession('t', project, true, recommend, (e) => events.push(e));
  s.meetingSpeech(true, Date.now());
  s.transcript(segment('a', 'What about the pilot?', 1));
  s.meetingSpeech(false, Date.now());
  await vi.advanceTimersByTimeAsync(400);
  expect(shown()).toBe('preview:We can discuss the pilot scope.');
  s.selfSpeech(true, true);
  expect(shown()).toBe('preview:We can discuss the pilot scope.');
  resolve(decision);
  await vi.advanceTimersByTimeAsync(1);
  expect(shown()).toBe('answer:We can discuss the pilot scope.');
});

it('keeps generating an automatic answer while the user speaks', async () => {
  let resolve!: (d: Decision) => void;
  const recommend: Recommend = () =>
    new Promise((r) => {
      resolve = r;
    });
  s = new MeetingSession('t', project, true, recommend, (e) => events.push(e));
  s.meetingSpeech(true, Date.now());
  s.transcript(segment('a', 'What about the pilot?', 1));
  s.meetingSpeech(false, Date.now());
  await vi.advanceTimersByTimeAsync(400);
  s.selfSpeech(true, true);
  expect(events.filter((e) => e.type === 'recommendation.finished' && e.reason)).toEqual([]);
  resolve(decision);
  await vi.advanceTimersByTimeAsync(1);
  expect(shown()).toBe('answer:We can discuss the pilot scope.');
});

it('cancels a hidden automatic answer when the microphone becomes unavailable', async () => {
  const recommend: Recommend = () => new Promise(() => {});
  s = new MeetingSession('t', project, true, recommend, (e) => events.push(e));
  s.meetingSpeech(true, Date.now());
  s.transcript(segment('a', 'What about the pilot?', 1));
  s.meetingSpeech(false, Date.now());
  await vi.advanceTimersByTimeAsync(400);
  s.selfSpeech(false, false);
  expect(events).toContainEqual(
    expect.objectContaining({
      type: 'recommendation.finished',
      reason: 'Microphone unavailable',
    }),
  );
  expect(shown()).toBeUndefined();
});

it('merges a continuation after a short pause instead of answering only the tail', async () => {
  const asked: string[] = [];
  s = new MeetingSession(
    't',
    project,
    true,
    // The first answer is still being generated when the speaker continues, as in the log.
    (input) => (
      asked.push(input.question ?? ''),
      asked.length === 1 ? new Promise<Decision>(() => {}) : Promise.resolve(decision)
    ),
    (e) => events.push(e),
  );
  s.meetingSpeech(true, Date.now());
  s.transcript(segment('a', 'Why is it novel beyond current deepfake detection?', 1));
  s.meetingSpeech(false, Date.now());
  await vi.advanceTimersByTimeAsync(500); // breath, then the speaker adds the rest
  s.meetingSpeech(true, Date.now());
  s.transcript(segment('b', 'Or multimodal verification approaches?', 2));
  s.meetingSpeech(false, Date.now());
  await vi.advanceTimersByTimeAsync(400);
  expect(asked.at(-1)).toBe(
    'Why is it novel beyond current deepfake detection? Or multimodal verification approaches?',
  );
  expect(shown()).toBe('answer:We can discuss the pilot scope.');
});

it('still starts a new question after a real pause', async () => {
  const asked: string[] = [];
  s = new MeetingSession(
    't',
    project,
    true,
    async (input) => (asked.push(input.question ?? ''), decision),
    (e) => events.push(e),
  );
  s.meetingSpeech(true, Date.now());
  s.transcript(segment('a', 'What about the pilot?', 1));
  s.meetingSpeech(false, Date.now());
  await vi.advanceTimersByTimeAsync(2000);
  s.meetingSpeech(true, Date.now());
  s.transcript(segment('b', 'How long will it take?', 2));
  s.meetingSpeech(false, Date.now());
  await vi.advanceTimersByTimeAsync(400);
  expect(asked).toEqual(['What about the pilot?', 'How long will it take?']);
});

it('publishes an answer to a question that only looks unfinished after a settle pause', async () => {
  s = new MeetingSession(
    't',
    project,
    true,
    async () => decision,
    (e) => events.push(e),
  );
  s.meetingSpeech(true, Date.now());
  s.transcript(segment('a', "Could you tell me what your company's role is", 1));
  s.meetingSpeech(false, Date.now());
  await vi.advanceTimersByTimeAsync(1000);
  expect(shown()).toBeUndefined(); // still allows "…is doing" to follow
  await vi.advanceTimersByTimeAsync(LIMITS.trailingSettleMs);
  expect(shown()).toBe('answer:We can discuss the pilot scope.');
});

it('announces a discarded hidden draft so no client keeps showing it', async () => {
  s = new MeetingSession(
    't',
    project,
    true,
    async () => decision,
    (e) => events.push(e),
  );
  s.meetingSpeech(true, Date.now());
  s.transcript(segment('a', 'What about the pilot?', 1, false));
  await vi.advanceTimersByTimeAsync(400); // speculative draft held while the speaker talks
  const started = events.find((e) => e.type === 'recommendation.started');
  s.transcript(segment('a', 'What about the pilot budget?', 1, false));
  expect(events).toContainEqual(
    expect.objectContaining({
      type: 'recommendation.finished',
      requestId: started && 'requestId' in started ? started.requestId : 'missing',
      reason: 'Question changed',
    }),
  );
});

describe('visibleCue', () => {
  const suggestion = (requestId: string) =>
    ({
      ...decision,
      requestId,
      at: 0,
      mode: 'automatic',
      questionId: 'q0',
      revision: 1,
    }) as Suggestion;
  const base = (): PanelState => ({
    ...initialState(),
    active: true,
    question: { id: 'q1', revision: 1, text: 'New?', segmentIds: [], state: 'QUESTION_FORMING' },
    suggestions: [suggestion('r2'), suggestion('r1')],
  });

  it('shows the newest answer even when it belongs to an earlier question', () => {
    expect(visibleCue(base()).cue?.requestId).toBe('r2');
  });
  it('lets a draft of a newer answer take over', () => {
    const state = {
      ...base(),
      currentRequestId: 'r3',
      preview: { ...decision, requestId: 'r3', questionId: 'q1', revision: 1 },
    };
    expect(visibleCue(state)).toEqual({ preview: state.preview });
  });
  it('ignores a draft for a superseded question revision', () => {
    const state = {
      ...base(),
      currentRequestId: 'r3',
      preview: { ...decision, requestId: 'r3', questionId: 'q1', revision: 0 },
    };
    expect(visibleCue(state).cue?.requestId).toBe('r2');
  });
  it('does not resurface an older answer after the newest is dismissed', () => {
    expect(visibleCue({ ...base(), cueDismissed: true, suggestions: [suggestion('r1')] })).toEqual({
      cue: undefined,
    });
  });
  it('shows nothing when the meeting is not active', () => {
    expect(visibleCue({ ...base(), active: false })).toEqual({});
  });
});

describe('Answer Now survives a question change', () => {
  it('shows the Answer Now result although a new question arrived while it was generated', async () => {
    const resolvers: ((d: Decision) => void)[] = [];
    s = new MeetingSession(
      't',
      project,
      true,
      () => new Promise((r) => resolvers.push(r)),
      (e) => events.push(e),
    );
    s.transcript(segment('a', 'What about the pilot?', 1));
    s.answer();
    s.meetingSpeech(true, Date.now());
    s.transcript(segment('b', 'How long will it take?', 2));
    expect(panel().question?.text).toBe('How long will it take?');
    expect(shown()).toBeUndefined();
    resolvers[0]({ ...decision, suggestedResponse: 'Manual answer.' });
    await vi.advanceTimersByTimeAsync(1);
    expect(shown()).toBe('answer:Manual answer.');
    expect(panel().question?.text).toBe('How long will it take?');
  });
});
