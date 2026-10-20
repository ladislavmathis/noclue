import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { MeetingSession } from '../packages/core/src/sessions/session';
import { ProviderError, type Recommend } from '../packages/core/src/recommendations/provider';
import { LIMITS, type Decision, type ServerEvent } from '@noclue/shared';
const project = {
  name: 'Fictional test',
  role: 'Lead',
  goal: 'Pilot',
  context: 'Pilot not yet completed.',
  keywords: [],
};
const decision: Decision = {
  action: 'suggest',
  responseType: 'answer' as const,
  category: 'question',
  triggerSegmentIds: ['a'],
  topicKey: 'pilot',
  recommendation: 'Clarify the next step.',
  suggestedResponse: 'We can discuss the pilot scope.',
  groundedFactIds: [],
  missingInformation: [],
};
let events: ServerEvent[], sessions: MeetingSession[];
function session(recommend: Recommend = async () => decision, mic = true) {
  const s = new MeetingSession('test', project, mic, recommend, (e) => events.push(e));
  sessions.push(s);
  return s;
}
const segment = (id = 'a', final = true) => ({
  id,
  sequence: id.charCodeAt(0),
  text: 'What about the pilot?',
  at: Date.now(),
  final,
});
const count = (type: string) => events.filter((e) => e.type === type).length;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(100_000);
  events = [];
  sessions = [];
});
afterEach(() => {
  sessions.forEach((s) => s.stop());
  vi.useRealTimers();
});
describe('recommendation scheduling', () => {
  it('prepares a hidden partial draft after 300 ms and reveals it only after speech ends and finalization', async () => {
    const f = vi.fn(async () => decision),
      s = session(f);
    s.meetingSpeech(true, Date.now());
    s.transcript(segment('a', false));
    await vi.advanceTimersByTimeAsync(299);
    expect(f).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(f).toHaveBeenCalledOnce();
    expect(count('recommendation.ready')).toBe(0);
    s.transcript(segment('a'));
    expect(count('recommendation.ready')).toBe(0);
    s.meetingSpeech(false, Date.now() - 100);
    expect(count('recommendation.ready')).toBe(1);
    expect(f).toHaveBeenCalledOnce();
  });
  it('answers a question transcribed while the user speaks and does not regenerate when own speech ends', async () => {
    const f = vi.fn(async () => decision),
      s = session(f);
    s.selfSpeech(true, true);
    s.transcript(segment());
    await vi.advanceTimersByTimeAsync(1);
    expect(f).toHaveBeenCalledOnce();
    expect(count('recommendation.ready')).toBe(1);
    s.selfSpeech(false, true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(f).toHaveBeenCalledOnce();
  });
  it('drops late results after the microphone became unavailable', async () => {
    let resolve!: (d: Decision) => void;
    const s = session(() => new Promise((r) => (resolve = r)));
    s.transcript(segment());
    await vi.advanceTimersByTimeAsync(800);
    s.selfSpeech(false, false);
    expect(
      events.some(
        (e) => e.type === 'recommendation.finished' && e.reason === 'Microphone unavailable',
      ),
    ).toBe(true);
    resolve(decision);
    await vi.advanceTimersByTimeAsync(1);
    expect(count('recommendation.ready')).toBe(0);
  });
  it('allows manual answers without microphone and while speaking, ignores double click', async () => {
    let resolve!: (d: Decision) => void;
    const f = vi.fn(() => new Promise<Decision>((r) => (resolve = r)));
    const s = session(f, false);
    s.selfSpeech(true, false);
    s.transcript(segment());
    await vi.advanceTimersByTimeAsync(5000);
    expect(f).not.toHaveBeenCalled();
    s.answer();
    s.answer();
    expect(f).toHaveBeenCalledOnce();
    resolve(decision);
    await vi.advanceTimersByTimeAsync(1);
    expect(count('recommendation.ready')).toBe(1);
  });
  it('prioritizes manual over automatic, even if automatic provider returns later', async () => {
    const resolvers: ((d: Decision) => void)[] = [];
    const s = session(() => new Promise((r) => resolvers.push(r)));
    s.transcript(segment());
    await vi.advanceTimersByTimeAsync(800);
    s.answer();
    resolvers[0](decision);
    resolvers[1](decision);
    await vi.advanceTimersByTimeAsync(1);
    expect(count('recommendation.ready')).toBe(1);
    const event = events.find((e) => e.type === 'recommendation.ready');
    expect(event?.type === 'recommendation.ready' && event.suggestion.mode).toBe('manual');
  });
  it('does not accept timed-out results and remains usable', async () => {
    const s = session(() => new Promise(() => {}));
    s.transcript(segment());
    s.answer();
    await vi.advanceTimersByTimeAsync(LIMITS.requestMs);
    expect(count('session.error')).toBe(1);
    expect(count('recommendation.finished')).toBe(1);
    expect(count('recommendation.ready')).toBe(0);
  });
  it('answers a new question on the same topic without the old 12-second cooldown', async () => {
    const f = vi.fn(async () => decision),
      s = session(f);
    s.transcript(segment());
    await vi.advanceTimersByTimeAsync(1);
    s.transcript(segment('b'));
    await vi.advanceTimersByTimeAsync(1);
    expect(f).toHaveBeenCalledTimes(2);
    expect(count('recommendation.ready')).toBe(2);
    s.transcript(segment('b'));
    await vi.advanceTimersByTimeAsync(5000);
    expect(f).toHaveBeenCalledTimes(2);
  });
  it('clears transcript, cancels timers and ignores all output after Stop', async () => {
    let resolve!: (d: Decision) => void;
    const s = session(() => new Promise((r) => (resolve = r)));
    s.transcript(segment());
    s.answer();
    s.stop();
    resolve(decision);
    await vi.advanceTimersByTimeAsync(20000);
    expect(s.segments).toEqual([]);
    expect(s.recent).toEqual([]);
    expect(count('recommendation.ready')).toBe(0);
  });
  it('deduplicates final events and orders segments by source sequence', () => {
    const s = session();
    s.transcript({ ...segment('b'), sequence: 2 });
    s.transcript({ ...segment('a'), sequence: 1 });
    s.transcript({ ...segment('b'), sequence: 2 });
    expect(s.segments.map((s) => s.id)).toEqual(['a', 'b']);
    expect(count('transcript.final')).toBe(2);
  });
  it('expires old content during silence and allows partial-only manual context', async () => {
    const f = vi.fn<Recommend>(async () => decision),
      s = session(f);
    s.transcript(segment('a', false));
    s.answer();
    await vi.advanceTimersByTimeAsync(1);
    expect(f.mock.calls[0]?.[0].segments[0].final).toBe(false);
    await vi.advanceTimersByTimeAsync(301000);
    expect(s.segments).toEqual([]);
  });
  it('honors Retry-After and preserves transcription after API errors', async () => {
    const f = vi.fn(async () => {
        throw new ProviderError('RATE_LIMIT', 'Wait', true, 20000);
      }),
      s = session(f);
    s.transcript(segment());
    s.answer();
    await vi.advanceTimersByTimeAsync(1);
    s.answer();
    expect(f).toHaveBeenCalledOnce();
    s.transcript(segment('b'));
    expect(s.segments).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(20000);
    expect(f).toHaveBeenCalledTimes(2);
  });
});

it('sends only newly completed segment IDs on subsequent automatic analyses', async () => {
  const f = vi.fn<Recommend>(async () => ({
    ...decision,
    action: 'skip',
    responseType: 'none' as const,
    category: 'none',
    topicKey: '',
    recommendation: '',
    suggestedResponse: '',
    triggerSegmentIds: [],
    groundedFactIds: [],
    missingInformation: [],
  }));
  const s = session(f);
  s.transcript(segment('a'));
  await vi.advanceTimersByTimeAsync(800);
  expect(f.mock.calls[0][0].newSegmentIds).toEqual(['a']);
  s.transcript(segment('b'));
  await vi.advanceTimersByTimeAsync(5000);
  expect(f.mock.calls[1][0].newSegmentIds).toEqual(['b']);
  expect(f.mock.calls[1][0].segments.map((s) => s.id)).toEqual(['a', 'b']);
});

it('invalidates a hidden draft on a meaning change and ignores a cancelled late result', async () => {
  const resolve: ((d: Decision) => void)[] = [];
  const f = vi.fn<Recommend>(() => new Promise((r) => resolve.push(r)));
  const s = session(f);
  s.meetingSpeech(true, Date.now());
  s.transcript({ ...segment('a', false), text: 'How does ORBIT detect deepfakes' });
  await vi.advanceTimersByTimeAsync(300);
  s.transcript({ ...segment('a', false), text: 'Actually what TRL are you aiming for' });
  expect(f.mock.calls[0][1].aborted).toBe(true);
  resolve[0](decision);
  await vi.advanceTimersByTimeAsync(LIMITS.speculationMs - 1);
  expect(count('recommendation.ready')).toBe(0);
  expect(f).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(f).toHaveBeenCalledTimes(2);
  resolve[1](decision);
  await vi.advanceTimersByTimeAsync(1);
  s.transcript({ ...segment('a'), text: 'Actually what TRL are you aiming for?' });
  s.meetingSpeech(false, Date.now() - 700);
  expect(count('recommendation.ready')).toBe(1);
});

it('does not finalize an unfinished clause at a pause and merges the continuation', async () => {
  const f = vi.fn<Recommend>(async () => ({ ...decision, questionComplete: true }));
  const s = session(f);
  s.meetingSpeech(true, Date.now());
  s.transcript({ ...segment('a'), text: 'How does ORBIT adapt to' });
  s.meetingSpeech(false, Date.now());
  await vi.advanceTimersByTimeAsync(1200);
  expect(count('recommendation.ready')).toBe(0);
  s.meetingSpeech(true, Date.now());
  s.transcript({ ...segment('b'), text: 'new evidence' });
  s.meetingSpeech(false, Date.now());
  await vi.advanceTimersByTimeAsync(1);
  expect(count('recommendation.ready')).toBe(1);
  expect(f.mock.calls.at(-1)?.[0].question).toBe('How does ORBIT adapt to new evidence');
});

it('honors semantic incompleteness, then answers the question itself after the trailing silence', async () => {
  const f = vi.fn<Recommend>(async () => ({ ...decision, questionComplete: false }));
  const s = session(f);
  s.transcript({ ...segment(), text: 'How does the proposed approach?' });
  await vi.advanceTimersByTimeAsync(LIMITS.trailingSettleMs - 1);
  expect(count('recommendation.ready')).toBe(0);
  const waiting = events.filter((e) => e.type === 'question.updated').at(-1)!.question;
  expect(waiting.reason).toContain('Waiting for the rest of the question');
  await vi.advanceTimersByTimeAsync(2);
  expect(f).toHaveBeenCalledTimes(2);
  expect(count('recommendation.ready')).toBe(1);
  const e = events.find((e) => e.type === 'recommendation.ready');
  expect(e?.type === 'recommendation.ready' && e.suggestion.mode).toBe('automatic');
  expect(e?.type === 'recommendation.ready' && e.suggestion.recommendation).toContain(
    'Incomplete question',
  );
  s.answer();
  await vi.advanceTimersByTimeAsync(1);
  expect(count('recommendation.ready')).toBe(2);
  const manual = events.filter((e) => e.type === 'recommendation.ready').at(-1);
  expect(manual?.type === 'recommendation.ready' && manual.suggestion.recommendation).toContain(
    'Incomplete question',
  );
});

it('treats punctuation-only finalization as the same speculative revision', async () => {
  const f = vi.fn(async () => decision),
    s = session(f);
  s.meetingSpeech(true, Date.now());
  s.transcript({ ...segment('a', false), text: 'How does ORBIT adapt to new evidence' });
  await vi.advanceTimersByTimeAsync(300);
  s.transcript({ ...segment('a'), text: 'How does ORBIT adapt to new evidence?' });
  s.meetingSpeech(false, Date.now());
  await vi.advanceTimersByTimeAsync(1);
  expect(f).toHaveBeenCalledOnce();
  expect(count('recommendation.ready')).toBe(1);
});

it('logs question and generation identities only when test mode is enabled', async () => {
  const s = new MeetingSession(
    'test',
    project,
    true,
    async () => decision,
    (e) => events.push(e),
    true,
    'test-model',
  );
  sessions.push(s);
  s.meetingSpeech(true, Date.now());
  s.transcript(segment('a', false));
  await vi.advanceTimersByTimeAsync(300);
  s.transcript(segment());
  s.meetingSpeech(false, Date.now() - 100);
  const telemetry = events.filter((e) => e.type === 'telemetry.event');
  expect(
    telemetry.some((e) => e.event.kind === 'generation.started' && e.event.model === 'test-model'),
  ).toBe(true);
  expect(
    telemetry.some(
      (e) => e.event.kind === 'quick.ready' && e.event.questionId && e.event.requestId,
    ),
  ).toBe(true);
  events.length = 0;
  const normal = session();
  normal.transcript(segment());
  await vi.advanceTimersByTimeAsync(1);
  expect(
    events
      .filter((e) => e.type === 'telemetry.event')
      .every((e) => !('question' in e.event) && !('answer' in e.event)),
  ).toBe(true);
});

it('does not discard an explicit manual answer when own speech starts during generation', async () => {
  let resolve!: (d: Decision) => void;
  const s = session(() => new Promise((r) => (resolve = r)));
  s.transcript(segment('a', false));
  s.answer();
  s.selfSpeech(true, true);
  resolve(decision);
  await vi.advanceTimersByTimeAsync(1);
  expect(count('recommendation.ready')).toBe(1);
});
it('keeps finalized non-question chatter out of the next question', async () => {
  const f = vi.fn(async () => decision),
    s = session(f);
  s.transcript({ ...segment('a'), text: 'Thank you everyone for joining today.' });
  await vi.advanceTimersByTimeAsync(1000);
  expect(f).not.toHaveBeenCalled();
  s.transcript({ ...segment('b'), text: 'What is ORBIT?' });
  await vi.advanceTimersByTimeAsync(1);
  expect(
    events.some(
      (e) => e.type === 'recommendation.ready' && e.suggestion.question === 'What is ORBIT?',
    ),
  ).toBe(true);
});

it('retains a multi-segment question for Answer Now without an available microphone', async () => {
  const f = vi.fn<Recommend>(async () => decision),
    s = session(f, false);
  s.transcript({ ...segment('a'), text: 'How does ORBIT adapt to' });
  s.transcript({ ...segment('b'), text: 'new evidence?' });
  await vi.advanceTimersByTimeAsync(1000);
  expect(f).not.toHaveBeenCalled();
  s.answer();
  await vi.advanceTimersByTimeAsync(1);
  expect(f.mock.calls[0][0].question).toBe('How does ORBIT adapt to new evidence?');
  expect(count('recommendation.ready')).toBe(1);
});
it('delivers an automatic answer whose generation own speech interrupted', async () => {
  let resolve!: (d: Decision) => void;
  const s = session(() => new Promise((r) => (resolve = r)));
  s.transcript(segment());
  await vi.advanceTimersByTimeAsync(1);
  s.selfSpeech(true, true);
  expect(events.some((e) => e.type === 'recommendation.finished' && e.reason)).toBe(false);
  resolve(decision);
  await vi.advanceTimersByTimeAsync(1);
  expect(count('recommendation.ready')).toBe(1);
});
it('keeps a held draft through own speech and reveals it once the question finalizes', async () => {
  const f = vi.fn(async () => decision),
    s = session(f);
  s.meetingSpeech(true, Date.now());
  s.transcript(segment('a', false));
  await vi.advanceTimersByTimeAsync(300);
  expect(f).toHaveBeenCalledOnce();
  expect(count('recommendation.ready')).toBe(0);
  s.selfSpeech(true, true);
  expect(events.some((e) => e.type === 'recommendation.finished' && e.reason)).toBe(false);
  s.transcript(segment('a'));
  s.meetingSpeech(false, Date.now() - 100);
  expect(count('recommendation.ready')).toBe(1);
  expect(f).toHaveBeenCalledOnce();
});

it('waits for the trailing audio commit instead of publishing an earlier finalized chunk', async () => {
  const s = session(async () => decision);
  s.meetingSpeech(true, Date.now());
  s.audioCommitted(segment('a').sequence);
  s.transcript(segment('a'));
  await vi.advanceTimersByTimeAsync(300);
  s.audioCommitted(segment('b').sequence);
  s.meetingSpeech(false, Date.now());
  await vi.advanceTimersByTimeAsync(1000);
  expect(count('recommendation.ready')).toBe(0);
  s.transcript({ ...segment('b'), text: 'Specifically, what evidence is proposed?' });
  await vi.advanceTimersByTimeAsync(1);
  expect(count('recommendation.ready')).toBe(1);
});

it('terminates a stalled committed segment and permits a repeated question', async () => {
  const f = vi.fn<Recommend>(async () => decision),
    s = session(f);
  s.audioCommitted(1);
  s.transcript({ ...segment('a', false), sequence: 1 });
  await vi.advanceTimersByTimeAsync(31_000);
  expect(events.some((e) => e.type === 'session.error' && e.code === 'TRANSCRIPTION_STALLED')).toBe(
    true,
  );
  s.meetingSpeech(true, Date.now());
  s.transcript({ ...segment('b'), sequence: 2 });
  s.meetingSpeech(false, Date.now());
  await vi.advanceTimersByTimeAsync(1);
  expect(count('recommendation.ready')).toBe(1);
});
it('shows a bounded incomplete-question error and allows manual retry with the same ID', async () => {
  const s = session(async () => ({ ...decision, questionComplete: false }));
  s.transcript(segment());
  await vi.advanceTimersByTimeAsync(1);
  // The speaker resumes but nothing more is transcribed, so the question cannot settle.
  s.meetingSpeech(true, Date.now());
  await vi.advanceTimersByTimeAsync(31_000);
  const failed = events.find((e) => e.type === 'session.error' && e.code === 'QUESTION_INCOMPLETE');
  expect(failed).toBeDefined();
  s.answer();
  await vi.advanceTimersByTimeAsync(1);
  const answer = events.find((e) => e.type === 'recommendation.ready');
  expect(answer?.type === 'recommendation.ready' && answer.suggestion.questionId).toBe(
    failed?.type === 'session.error' && failed.questionId,
  );
});
it('does not report incomplete questions when automatic answers are off, and Answer Now still works', async () => {
  const s = session(async () => decision, false);
  s.transcript({ ...segment('a'), text: 'Thanks, that sounds good.' });
  s.transcript({ ...segment('b'), text: 'What about the pilot' });
  await vi.advanceTimersByTimeAsync(5 * 60_000 + 2_000);
  expect(count('session.error')).toBe(0);
  s.transcript({ ...segment('c'), text: 'What about the pilot?' });
  s.answer();
  await vi.advanceTimersByTimeAsync(1);
  const ready = events.find((e) => e.type === 'recommendation.ready');
  expect(ready?.type === 'recommendation.ready' && ready.suggestion.question).toBe(
    'What about the pilot?',
  );
});
it('closes small talk without a microphone so it does not merge into the next question', async () => {
  const s = session(async () => decision, false);
  s.transcript({ ...segment('a'), text: 'Thanks, that sounds good.' });
  const settled = events.filter((e) => e.type === 'question.updated').at(-1);
  expect(settled?.type === 'question.updated' && settled.question.state).toBe('LISTENING');
});
it('keeps Answer Now available after a request-specific configuration error', async () => {
  let calls = 0;
  const s = session(async () => {
    if (calls++ === 0) throw new ProviderError('MODEL_CONFIGURATION', 'Rejected.');
    return decision;
  });
  s.transcript(segment());
  s.answer();
  await vi.advanceTimersByTimeAsync(1);
  expect(count('session.error')).toBe(1);
  s.answer();
  await vi.advanceTimersByTimeAsync(1);
  expect(count('recommendation.ready')).toBe(1);
});
it('retries a failed question with a new attempt and starts repeated speech with a new question ID', async () => {
  const f = vi
    .fn<Recommend>()
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue(decision);
  const s = session(f);
  s.transcript(segment());
  await vi.advanceTimersByTimeAsync(1);
  const first = events.find((e) => e.type === 'recommendation.started')!;
  s.answer(first.type === 'recommendation.started' ? first.questionId : undefined);
  await vi.advanceTimersByTimeAsync(1);
  s.meetingSpeech(true, Date.now());
  s.transcript(segment('b'));
  s.meetingSpeech(false, Date.now());
  await vi.advanceTimersByTimeAsync(1);
  const starts = events.filter((e) => e.type === 'recommendation.started');
  expect(starts).toHaveLength(3);
  expect(starts[0].questionId).toBe(starts[1].questionId);
  expect(starts[0].requestId).not.toBe(starts[1].requestId);
  expect(starts[2].questionId).not.toBe(starts[1].questionId);
});
it('does not merge a repeated question into a failed earlier question', async () => {
  const f = vi
    .fn<Recommend>()
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue(decision);
  const s = session(f);
  s.transcript(segment());
  await vi.advanceTimersByTimeAsync(1);
  s.meetingSpeech(true, Date.now());
  s.transcript(segment('b'));
  s.meetingSpeech(false, Date.now());
  await vi.advanceTimersByTimeAsync(1);
  expect(f.mock.calls[1][0].question).toBe(segment().text);
  expect(count('recommendation.ready')).toBe(1);
});
it('maps twenty consecutive questions correctly when old providers resolve out of order', async () => {
  const pending: { input: Parameters<Recommend>[0]; resolve: (d: Decision) => void }[] = [];
  const s = session((input) => new Promise((resolve) => pending.push({ input, resolve })));
  for (let i = 0; i < 20; i++) {
    if (i) await vi.advanceTimersByTimeAsync(LIMITS.continuationMs); // pause between turns
    s.meetingSpeech(true, Date.now());
    s.transcript({
      id: `q${i}`,
      sequence: i,
      at: Date.now(),
      text: `What is topic ${i}?`,
      final: true,
    });
    s.meetingSpeech(false, Date.now());
    await vi.advanceTimersByTimeAsync(1);
    if (i % 2) {
      pending[i].resolve({ ...decision, suggestedResponse: `Answer ${i}` });
      pending[i - 1].resolve({ ...decision, suggestedResponse: `Answer ${i - 1}` });
      await vi.advanceTimersByTimeAsync(1);
    }
  }
  const answers = events.filter((e) => e.type === 'recommendation.ready');
  expect(answers).toHaveLength(10);
  for (const e of answers)
    expect(e.suggestion.suggestedResponse).toBe(
      `Answer ${e.suggestion.question!.match(/\d+/)![0]}`,
    );
  expect([...s.questions.values()].filter((q) => q.state === 'CANCELLED')).toHaveLength(10);
  expect(pending[0].input.question).toBe('What is topic 0?');
});
it('simulates thirty minutes with 30 project, 5 general, 5 personal and 5 repeated questions and five topic switches', async () => {
  const f = vi.fn<Recommend>(async (input) => ({
    ...decision,
    suggestedResponse: input.question!,
  }));
  const s = session(f);
  const projectQs = [
    'What is the review pipeline?',
    'How is uncertainty communicated?',
    'What will the pilot show?',
    'What happens with insufficient evidence?',
    'Can it plan further verification?',
    'What is the evidence model?',
  ];
  const questions = Array.from({ length: 30 }, (_, i) => projectQs[Math.floor(i / 5)]);
  questions.push(
    ...Array(5).fill('What is calibration?'),
    ...Array(5).fill('What are my responsibilities?'),
    ...Array(5).fill('What is the review pipeline?'),
  );
  for (let i = 0; i < questions.length; i++) {
    s.meetingSpeech(true, Date.now());
    s.transcript({ id: `soak-${i}`, sequence: i, at: Date.now(), final: true, text: questions[i] });
    s.meetingSpeech(false, Date.now());
    await vi.advanceTimersByTimeAsync(40_000);
  }
  const answers = events.filter((e) => e.type === 'recommendation.ready');
  expect(answers).toHaveLength(45);
  expect(answers.every((e) => e.suggestion.question === e.suggestion.suggestedResponse)).toBe(true);
  expect(new Set(answers.map((e) => e.suggestion.questionId)).size).toBe(45);
  expect(count('session.error')).toBe(0);
  expect(s.diagnostics.length).toBeLessThanOrEqual(2000);
});

it('clears an empty final commit without replacing the answered question', async () => {
  const s = session();
  s.transcript(segment());
  await vi.advanceTimersByTimeAsync(1);
  const before = events.filter((e) => e.type === 'question.updated').at(-1)!.question.id;
  s.audioCommitted(77);
  s.transcript({ id: 'empty', sequence: 77, at: Date.now(), text: '', final: true });
  await vi.advanceTimersByTimeAsync(31_000);
  expect(count('session.error')).toBe(0);
  expect(events.filter((e) => e.type === 'question.updated').at(-1)!.question.id).toBe(before);
});

it('processes both report abstention questions as separate events without question marks', async () => {
  const f = vi.fn<Recommend>(async () => decision),
    s = session(f);
  const questions = [
    'In those abstention cases does the system propose next steps for a human reviewer or does it simply stop and present the evidence',
    'In those abstention cases does the system propose next steps for a human reviewer or does it just present the evidence as is',
  ];
  for (let i = 0; i < questions.length; i++) {
    s.meetingSpeech(true, Date.now());
    s.transcript({
      id: `report-repeat-${i}`,
      sequence: i,
      text: questions[i],
      at: Date.now(),
      final: true,
    });
    s.meetingSpeech(false, Date.now());
    await vi.advanceTimersByTimeAsync(1);
  }
  expect(count('recommendation.ready')).toBe(2);
  expect(f.mock.calls.map((call) => call[0].question)).toEqual(questions);
});

it('retains the latest question for an explicit manual retry after new speech starts but before its transcript arrives', async () => {
  const f = vi.fn<Recommend>(async () => decision),
    s = session(f, false);
  s.transcript(segment());
  const q = events.filter((e) => e.type === 'question.updated').at(-1)!.question;
  s.meetingSpeech(true, Date.now());
  s.answer(q.id);
  await vi.advanceTimersByTimeAsync(1);
  expect(count('recommendation.ready')).toBe(1);
  expect(f.mock.calls[0][0].question).toBe(q.text);
  s.transcript({ ...segment('b'), text: 'How is uncertainty shown?' });
  s.meetingSpeech(false, Date.now());
  s.answer();
  await vi.advanceTimersByTimeAsync(1);
  expect(f.mock.calls[1][0].question).toBe('How is uncertainty shown?');
});

it('completes the same question after a provider backoff instead of leaving a hidden draft', async () => {
  const f = vi
    .fn<Recommend>()
    .mockRejectedValueOnce(new ProviderError('RATE_LIMIT', 'Wait', true, 2000))
    .mockResolvedValue(decision);
  const s = session(f);
  s.transcript(segment());
  await vi.advanceTimersByTimeAsync(2100);
  expect(count('recommendation.ready')).toBe(1);
  const starts = events.filter((e) => e.type === 'recommendation.started');
  expect(starts).toHaveLength(2);
  expect(starts[0].questionId).toBe(starts[1].questionId);
});
it('forwards an unverified preview for the current manual attempt before the checked answer', async () => {
  let resolve!: (d: Decision) => void;
  const s = session(
    (input) =>
      new Promise((r) => {
        input.onPreview?.({ ...decision, suggestedResponse: 'Draft wording.' });
        resolve = r;
      }),
  );
  s.transcript(segment('a'));
  s.answer();
  const preview = events.find((e) => e.type === 'recommendation.preview');
  const started = events.find((e) => e.type === 'recommendation.started');
  expect(preview && preview.type === 'recommendation.preview' && preview.preview).toMatchObject({
    suggestedResponse: 'Draft wording.',
    requestId: started && started.type === 'recommendation.started' ? started.requestId : 'x',
  });
  expect(count('recommendation.ready')).toBe(0);
  resolve(decision);
  await vi.advanceTimersByTimeAsync(1);
  expect(count('recommendation.ready')).toBe(1);
});
it('does not preview when the user turned previews off', async () => {
  const s = new MeetingSession(
    'test',
    {
      ...project,
      preferences: {
        tone: 'professional',
        length: 'standard',
        strictContext: false,
        silenceMs: 700,
        previewUnverified: false,
      },
    },
    true,
    async (input) => {
      expect(input.onPreview).toBeUndefined();
      return decision;
    },
    (e) => events.push(e),
  );
  sessions.push(s);
  s.transcript(segment('a'));
  s.answer();
  await vi.advanceTimersByTimeAsync(1);
  expect(count('recommendation.preview')).toBe(0);
  expect(count('recommendation.ready')).toBe(1);
});
it('does not preview a speculative automatic draft while the speaker is still talking', async () => {
  const s = session(async (input) => {
    input.onPreview?.(decision);
    return decision;
  });
  s.meetingSpeech(true, Date.now());
  s.transcript(segment('a', false));
  await vi.advanceTimersByTimeAsync(300);
  expect(count('recommendation.preview')).toBe(0);
});

describe('cue generation defects from the 2026-10-19 review', () => {
  const question = () => events.filter((e) => e.type === 'question.updated').at(-1)!.question;
  it('answers the current question on Answer Now after own speech instead of ignoring the ID', async () => {
    const f = vi.fn<Recommend>(async () => decision),
      s = session(f);
    s.transcript(segment());
    const q = question();
    s.selfSpeech(true, true);
    s.selfSpeech(false, true);
    expect(f).not.toHaveBeenCalled();
    s.answer(q.id);
    await vi.advanceTimersByTimeAsync(1);
    expect(f).toHaveBeenCalledOnce();
    expect(count('recommendation.ready')).toBe(1);
    expect(question().id).toBe(q.id);
  });
  it('treats a stale question ID on Answer Now as a request for the latest question', async () => {
    const f = vi.fn<Recommend>(async () => decision),
      s = session(f, false);
    s.transcript(segment());
    const stale = question();
    s.answer(stale.id);
    await vi.advanceTimersByTimeAsync(1);
    s.meetingSpeech(true, Date.now());
    s.transcript({ ...segment('b'), text: 'How is uncertainty shown?' });
    s.meetingSpeech(false, Date.now());
    expect(question().id).not.toBe(stale.id);
    s.answer(stale.id);
    await vi.advanceTimersByTimeAsync(1);
    expect(f).toHaveBeenCalledTimes(2);
    expect(f.mock.calls[1][0].question).toBe('How is uncertainty shown?');
    expect(count('recommendation.ready')).toBe(2);
  });
  it('publishes a question built by Answer Now before recommendation.started', async () => {
    const s = session(async () => decision, false);
    s.transcript(segment());
    // The engine drops a question whose transcript expired (see the expiry interval).
    (s as unknown as { engine: { abandon(): void } }).engine.abandon();
    events = [];
    s.answer();
    await vi.advanceTimersByTimeAsync(1);
    const started = events.findIndex((e) => e.type === 'recommendation.started');
    const startedEvent = events[started];
    const published = events.findIndex(
      (e) =>
        e.type === 'question.updated' &&
        startedEvent.type === 'recommendation.started' &&
        e.question.id === startedEvent.questionId &&
        e.question.revision === startedEvent.revision,
    );
    expect(started).toBeGreaterThan(-1);
    expect(published).toBeGreaterThan(-1);
    expect(published).toBeLessThan(started);
    expect(count('recommendation.ready')).toBe(1);
  });
  it('keeps the question open when a speculative attempt fails and answers the final transcript', async () => {
    const f = vi
      .fn<Recommend>()
      .mockImplementationOnce(
        () =>
          new Promise((_, reject) =>
            setTimeout(() => reject(new ProviderError('RATE_LIMIT', 'Wait', true)), 400),
          ),
      )
      .mockResolvedValue(decision);
    const s = session(f);
    s.meetingSpeech(true, Date.now());
    s.transcript({ ...segment('a', false), text: 'What is the budget' });
    await vi.advanceTimersByTimeAsync(300);
    expect(f).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(400);
    expect(count('session.error')).toBe(0);
    expect(question().state).not.toBe('FAILED');
    s.transcript({ ...segment('a'), text: 'What is the budget for the pilot?' });
    s.meetingSpeech(false, Date.now());
    await vi.advanceTimersByTimeAsync(1);
    expect(count('recommendation.ready')).toBe(1);
    expect(f.mock.calls.at(-1)?.[0].question).toBe('What is the budget for the pilot?');
    expect(question().state).toBe('ANSWERING');
    expect(count('session.error')).toBe(0);
  });
  it('still fails a finalizable automatic attempt and a manual attempt as before', async () => {
    const f = vi.fn<Recommend>(async () => {
      throw new ProviderError('INVALID_GROUNDING', 'Ungrounded.');
    });
    const s = session(f);
    s.transcript(segment());
    await vi.advanceTimersByTimeAsync(1);
    expect(count('session.error')).toBe(1);
    expect(question().state).toBe('FAILED');
    s.answer();
    await vi.advanceTimersByTimeAsync(1);
    expect(count('session.error')).toBe(2);
    expect(question().state).toBe('FAILED');
  });
  it('retries after Retry-After even when transcript and speech events keep arriving', async () => {
    const f = vi
      .fn<Recommend>()
      .mockRejectedValueOnce(new ProviderError('RATE_LIMIT', 'Wait', true, 1000))
      .mockResolvedValue(decision);
    const s = session(f);
    s.transcript(segment());
    await vi.advanceTimersByTimeAsync(1);
    expect(question().state).toBe('FAILED');
    for (let i = 0; i < 4; i++) {
      await vi.advanceTimersByTimeAsync(200);
      s.transcript({ ...segment(String.fromCharCode('b'.charCodeAt(0) + i)), text: '' });
      s.meetingSpeech(false, Date.now());
    }
    await vi.advanceTimersByTimeAsync(300);
    expect(f).toHaveBeenCalledTimes(2);
    expect(count('recommendation.ready')).toBe(1);
    const starts = events.filter((e) => e.type === 'recommendation.started');
    expect(starts[0].questionId).toBe(starts[1].questionId);
  });
  it('answers a question whose transcript arrived around own speech without any guard delay', async () => {
    const f = vi.fn<Recommend>(async () => decision),
      s = session(f);
    s.meetingSpeech(true, Date.now());
    s.transcript(segment('a', false));
    s.selfSpeech(true, true);
    await vi.advanceTimersByTimeAsync(200);
    s.selfSpeech(false, true);
    await vi.advanceTimersByTimeAsync(400);
    s.transcript(segment('a'));
    s.meetingSpeech(false, Date.now());
    await vi.advanceTimersByTimeAsync(1);
    expect(f).toHaveBeenCalledOnce();
    expect(count('recommendation.ready')).toBe(1);
    expect(question().state).toBe('ANSWERING');
  });
  it('keeps the question that a backchannel interrupted and merges its continuation', async () => {
    const f = vi.fn<Recommend>(async () => decision),
      s = session(f);
    s.meetingSpeech(true, Date.now());
    s.transcript({ ...segment('a'), text: 'What is the budget for' });
    const q = question();
    s.selfSpeech(true, true);
    await vi.advanceTimersByTimeAsync(300);
    s.selfSpeech(false, true);
    await vi.advanceTimersByTimeAsync(500);
    s.transcript({ ...segment('b'), text: 'the pilot?' });
    s.meetingSpeech(false, Date.now());
    await vi.advanceTimersByTimeAsync(1);
    expect(question().id).toBe(q.id);
    expect(count('recommendation.ready')).toBe(1);
    // The speculation over the trailing-word text is discarded; the final answer covers the whole question.
    expect(f.mock.calls.at(-1)?.[0].question).toBe('What is the budget for the pilot?');
  });
});

describe('further observations from the 2026-10-19 review', () => {
  const question = () => events.filter((e) => e.type === 'question.updated').at(-1)!.question;
  it('extends a question answered by Answer Now while partial and answers the full text automatically', async () => {
    const f = vi.fn<Recommend>(async () => decision),
      s = session(f);
    s.meetingSpeech(true, Date.now());
    s.transcript({ ...segment('a', false), text: 'What is the budget' });
    s.answer();
    await vi.advanceTimersByTimeAsync(1);
    expect(count('recommendation.ready')).toBe(1);
    const q = question();
    expect(q.state).toBe('ANSWERING');
    s.transcript({ ...segment('a'), text: 'What is the budget for the pilot?' });
    expect(question().id).toBe(q.id);
    expect(question().text).toBe('What is the budget for the pilot?');
    s.meetingSpeech(false, Date.now());
    await vi.advanceTimersByTimeAsync(1);
    expect(count('recommendation.ready')).toBe(2);
    expect(f.mock.calls[1][0].question).toBe('What is the budget for the pilot?');
  });
  it('does not answer again when the final transcript only adds punctuation to an answered partial', async () => {
    const f = vi.fn<Recommend>(async () => decision),
      s = session(f);
    s.meetingSpeech(true, Date.now());
    s.transcript({ ...segment('a', false), text: 'What about the pilot' });
    s.answer();
    await vi.advanceTimersByTimeAsync(1);
    s.transcript({ ...segment('a'), text: 'What about the pilot?' });
    s.meetingSpeech(false, Date.now());
    await vi.advanceTimersByTimeAsync(3000);
    expect(f).toHaveBeenCalledOnce();
    expect(question().text).toBe('What about the pilot?');
    expect(question().state).toBe('ANSWERING');
  });
  it('delivers an Answer Now result although another question arrived meanwhile, then answers that one', async () => {
    const resolvers: ((d: Decision) => void)[] = [];
    const f = vi.fn<Recommend>(() => new Promise((r) => resolvers.push(r)));
    const s = session(f);
    s.transcript(segment());
    s.answer();
    const first = question();
    expect(f).toHaveBeenCalledOnce();
    s.meetingSpeech(true, Date.now());
    s.transcript({ ...segment('b'), text: 'How is uncertainty shown?' });
    s.meetingSpeech(false, Date.now());
    expect(question().id).not.toBe(first.id);
    expect(count('recommendation.finished')).toBe(0);
    resolvers[0]({ ...decision, suggestedResponse: 'First answer.' });
    await vi.advanceTimersByTimeAsync(1);
    const ready = events.filter((e) => e.type === 'recommendation.ready');
    expect(ready).toHaveLength(1);
    expect(ready[0].type === 'recommendation.ready' && ready[0].suggestion).toMatchObject({
      mode: 'manual',
      questionId: first.id,
      revision: first.revision,
      question: 'What about the pilot?',
      suggestedResponse: 'First answer.',
    });
    expect(f).toHaveBeenCalledTimes(2);
    resolvers[1](decision);
    await vi.advanceTimersByTimeAsync(1);
    expect(count('recommendation.ready')).toBe(2);
    expect(f.mock.calls[1][0].question).toBe('How is uncertainty shown?');
  });
  it('does not speculate over a partial question that still reads unfinished', async () => {
    const f = vi.fn<Recommend>(async () => decision),
      s = session(f);
    s.meetingSpeech(true, Date.now());
    s.transcript({ ...segment('a', false), text: 'How does ORBIT adapt to' });
    await vi.advanceTimersByTimeAsync(1500);
    expect(f).not.toHaveBeenCalled();
    s.transcript({ ...segment('a', false), text: 'How does ORBIT adapt to new evidence' });
    await vi.advanceTimersByTimeAsync(300);
    expect(f).toHaveBeenCalledOnce();
  });
  it('still completes a trailing-word question after the settle silence without speculation', async () => {
    const f = vi.fn<Recommend>(async () => ({ ...decision, questionComplete: true })),
      s = session(f);
    s.meetingSpeech(true, Date.now());
    s.transcript({ ...segment('a'), text: 'Tell me what your role is' });
    s.meetingSpeech(false, Date.now());
    await vi.advanceTimersByTimeAsync(LIMITS.trailingSettleMs - 1);
    expect(f).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(f).toHaveBeenCalledOnce();
    expect(count('recommendation.ready')).toBe(1);
  });
});
