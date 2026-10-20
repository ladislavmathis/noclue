import {
  LIMITS,
  PROMPT_VERSION,
  factsForProject,
  pruneSegments,
  type Project,
  type QuestionState,
  type Segment,
  type ServerEvent,
  type Suggestion,
  type TimelineEvent,
} from '@noclue/shared';
import { safeError, type Recommend } from '../recommendations/provider.js';
import { QuestionEngine, inspectQuestion } from '../questions/engine.js';

type Result = Awaited<ReturnType<Recommend>>;
type Attempt = {
  id: string;
  questionId: string;
  revision: number;
  mode: 'automatic' | 'manual';
  /** Question text as sent to the generator. */
  question: string;
  controller: AbortController;
  /** Its draft was on screen, which required the question to be complete at that time. */
  previewed?: boolean;
  /** Final attempt after the trailing silence: a questionComplete=false verdict no longer holds it back. */
  acceptIncomplete?: boolean;
};
export class MeetingSession {
  segments: Segment[] = [];
  recent: Suggestion[] = [];
  private engine = new QuestionEngine();
  private stopped = false;
  private retryUntil = 0;
  private disabled = false;
  private pendingCommits = new Map<number, number>();
  private lastProgress = Date.now();
  readonly diagnostics: TimelineEvent[] = [];
  readonly questions = new Map<string, import('@noclue/shared').QuestionState>();
  private lastSpeculation = -Infinity;
  private timer?: ReturnType<typeof setTimeout>;
  /** Provider backoff retry; it survives the advance() calls that live transcript keeps making. */
  private retryTimer?: ReturnType<typeof setTimeout>;
  /** One more attempt for a question the generator judged incomplete, once the speaker stays silent. */
  private continuationTimer?: ReturnType<typeof setTimeout>;
  private expiry: ReturnType<typeof setInterval>;
  private active?: Attempt;
  private draft?: { attempt: Attempt; result: Result };
  constructor(
    readonly id: string,
    private project: Project,
    private micAvailable: boolean,
    private recommend: Recommend,
    private emit: (event: ServerEvent) => void,
    private testMode = false,
    private model = 'configured',
  ) {
    this.expiry = setInterval(() => {
      this.segments = pruneSegments(this.segments);
      const q = this.engine.current;
      if ([...this.pendingCommits.values()].some((at) => Date.now() - at >= 30_000)) {
        this.pendingCommits.clear();
        this.failPipeline(
          'TRANSCRIPTION_STALLED',
          'Transcription did not finish. Repeat the question or try Answer Now.',
        );
      }
      // Without automatic answers (no microphone) nothing can complete the question,
      // so a timeout would only report a failure that did not happen.
      const auto = this.canAuto();
      if (
        q &&
        auto &&
        !['ANSWERING', 'FAILED', 'SKIPPED', 'CANCELLED', 'LISTENING'].includes(q.state) &&
        !this.active &&
        Date.now() - this.lastProgress >= 30_000
      ) {
        this.failPipeline(
          'QUESTION_INCOMPLETE',
          'The question did not finish. Repeat it or try Answer Now.',
        );
      }
      if (q && !q.segmentIds.some((id) => this.segments.some((s) => s.id === id))) {
        this.cancelActive('Question expired');
        this.discardDraft('Question expired');
        if (auto && !['ANSWERING', 'SKIPPED', 'FAILED', 'CANCELLED', 'LISTENING'].includes(q.state))
          this.failPipeline('QUESTION_EXPIRED', 'Question expired. Please repeat it.');
        this.engine.abandon();
      }
    }, 1000);
  }
  private log(kind: string, detail: Partial<TimelineEvent> = {}) {
    if (this.stopped) return;
    const q = this.engine.current;
    const event: TimelineEvent = {
      at: Date.now(),
      kind,
      sessionId: this.id,
      questionId: q?.id,
      revision: q?.revision,
      ...detail,
    };
    const { question, answer, facts, claims, ...metadata } = event;
    // Only stable error/event codes are retained outside explicit test mode.
    if (metadata.reason && !/^[A-Z_]+$/.test(metadata.reason)) delete metadata.reason;
    this.diagnostics.push(metadata);
    if (this.diagnostics.length > 2000) this.diagnostics.shift();
    this.emit({
      type: 'telemetry.event',
      sessionId: this.id,
      event: this.testMode ? event : metadata,
    });
  }
  failPipeline(code: string, message: string) {
    this.cancelActive(code);
    this.discardDraft(code);
    clearTimeout(this.timer);
    clearTimeout(this.retryTimer);
    const q = this.engine.current;
    if (q) {
      this.engine.consume();
      q.state = 'FAILED';
      q.reason = message;
    }
    this.log('pipeline.failed', { reason: code });
    this.publishQuestion();
    this.emit({
      type: 'session.error',
      sessionId: this.id,
      questionId: q?.id,
      revision: q?.revision,
      code,
      message,
      fatal: false,
      retryable: true,
    });
  }

  private publishQuestion() {
    if (this.engine.current) {
      this.questions.set(this.engine.current.id, structuredClone(this.engine.current));
      if (this.questions.size > 100) this.questions.delete(this.questions.keys().next().value!);
      this.emit({
        type: 'question.updated',
        sessionId: this.id,
        question: { ...this.engine.current, segmentIds: [...this.engine.current.segmentIds] },
      });
    }
  }
  private supersede(previous?: import('@noclue/shared').QuestionState) {
    if (!previous || previous.id === this.engine.current?.id) return;
    if (!['ANSWERING', 'FAILED', 'SKIPPED', 'CANCELLED', 'LISTENING'].includes(previous.state)) {
      const question = {
        ...previous,
        state: 'CANCELLED' as const,
        reason: 'Replaced by a new question.',
      };
      this.questions.set(question.id, question);
      this.log('question.cancelled', {
        questionId: question.id,
        revision: question.revision,
        reason: question.reason,
      });
    }
  }
  transcript(segment: Segment) {
    if (this.stopped || this.segments.find((s) => s.id === segment.id)?.final) return;
    this.segments = pruneSegments([...this.segments.filter((s) => s.id !== segment.id), segment]);
    this.emit({
      type: segment.final ? 'transcript.final' : 'transcript.delta',
      sessionId: this.id,
      segment,
    });
    this.lastProgress = Date.now();
    if (segment.final) this.pendingCommits.delete(segment.sequence);
    if (
      segment.final &&
      !segment.text.trim() &&
      !this.engine.current?.segmentIds.includes(segment.id)
    ) {
      this.log('transcript.final', { segmentId: segment.id, commitSequence: segment.sequence });
      this.advance();
      return;
    }
    const previous = this.engine.current ? structuredClone(this.engine.current) : undefined;
    const { changed, question } = this.engine.update(segment);
    this.supersede(previous);
    this.log(segment.final ? 'transcript.final' : 'transcript.partial', {
      question: question?.text,
      segmentId: segment.id,
      commitSequence: segment.sequence,
    });
    if (changed) {
      // An explicit Answer Now keeps running; its result is delivered for the question as asked.
      if (this.active?.mode !== 'manual') this.cancelActive('Question changed');
      this.discardDraft('Question changed');
      if (question && inspectQuestion(question.text).candidate)
        this.log('question.candidate', { question: question.text });
    }
    this.publishQuestion();
    if (!this.canAuto()) {
      this.settleNonQuestion();
      return;
    }
    this.advance();
  }
  audioCommitted(sequence: number) {
    if (!this.stopped) {
      this.pendingCommits.set(sequence, Date.now());
      this.log('audio.received', { commitSequence: sequence });
    }
  }
  private get canFinalize() {
    return this.engine.mayComplete && this.pendingCommits.size === 0;
  }
  meetingSpeech(active: boolean, speechAt: number) {
    if (this.stopped) return;
    const previous = this.engine.current ? structuredClone(this.engine.current) : undefined;
    this.engine.speech(active, speechAt);
    this.lastProgress = Date.now();
    this.supersede(previous);
    if (previous && this.engine.current?.id !== previous.id) {
      if (this.active?.mode !== 'manual') this.cancelActive('Superseded by new speech');
      this.discardDraft('Superseded by new speech');
    }
    this.log(active ? 'speech.started' : 'speech.stopped', { sourceAt: speechAt });
    this.publishQuestion();
    this.advance();
  }
  /**
   * Own speech does not touch cue generation: the user may be improvising while the cue is
   * still being prepared, and the cue window keeps earlier answers in its history. Only an
   * unavailable microphone turns automatic answers off; Answer Now keeps working.
   */
  selfSpeech(_speaking: boolean, available: boolean) {
    this.micAvailable = available;
    if (available) return;
    clearTimeout(this.timer);
    // A draft already on screen still finishes; a hidden automatic attempt is dropped.
    if (this.active?.mode === 'automatic' && !this.active.previewed)
      this.cancelActive('Microphone unavailable');
    this.discardDraft('Microphone unavailable');
  }
  private canAuto() {
    return !this.stopped && !this.disabled && this.micAvailable;
  }
  private advance() {
    clearTimeout(this.timer);
    const q = this.engine.current;
    if (
      !q ||
      this.engine.awaitingNewTurn ||
      !this.canAuto() ||
      ['ANSWERING', 'FAILED', 'SKIPPED', 'CANCELLED'].includes(q.state)
    )
      return;
    if (!inspectQuestion(q.text).candidate) {
      this.settleNonQuestion();
      return;
    }
    if (this.draft && this.canFinalize) {
      this.reveal(this.draft.attempt, this.draft.result);
      return;
    }
    const settle = this.engine.settleIn();
    const complete = inspectQuestion(q.text).complete;
    if (
      (this.active || this.draft || !complete) &&
      this.engine.finalized &&
      settle > 0 &&
      settle < Infinity
    ) {
      // Re-check once the pause is long enough for a trailing-word question to count as complete.
      this.timer = setTimeout(() => {
        this.engine.refresh();
        this.publishQuestion();
        this.advance();
      }, settle);
      return;
    }
    if (this.active || this.draft) return;
    // Speculation over a question still being spoken only when its text already reads as a
    // complete question; "…what is the budget for" would be redone with the next words anyway.
    if (!this.canFinalize && !complete) return;
    const wait = Math.max(
      this.retryUntil - Date.now(),
      this.canFinalize
        ? 0
        : Math.max(300, this.lastSpeculation + LIMITS.speculationMs - Date.now()),
    );
    this.timer = setTimeout(() => {
      if (this.canAuto()) void this.generate('automatic');
    }, wait);
  }
  /** Close finished small talk so it neither waits for completion nor merges into the next question. */
  private settleNonQuestion() {
    const q = this.engine.current;
    if (
      !q ||
      ['ANSWERING', 'FAILED', 'SKIPPED', 'CANCELLED', 'LISTENING'].includes(q.state) ||
      inspectQuestion(q.text).candidate ||
      !this.engine.finalized ||
      this.engine.speaking
    )
      return;
    this.engine.consume();
    q.state = 'LISTENING';
    this.publishQuestion();
  }
  /**
   * Answer Now. The panel may still show a question the engine has since replaced or
   * dropped, so an unknown or stale ID means "answer the latest question" rather than nothing.
   */
  answer(_questionId?: string) {
    if (this.stopped || this.active?.mode === 'manual') return;
    clearTimeout(this.timer);
    clearTimeout(this.retryTimer);
    this.cancelActive('Replaced by Answer Now');
    this.discardDraft('Replaced by Answer Now');
    if (!this.engine.current) {
      const latest = [...this.segments].sort((a, b) => a.sequence - b.sequence).at(-1);
      if (latest) {
        this.engine.reset();
        this.engine.update(latest);
      }
    }
    this.engine.retry();
    this.lastProgress = Date.now();
    // The extension only tracks requests for a question it already knows, so the question
    // (possibly new, or no longer failed) is published before recommendation.started.
    if (this.engine.current) this.engine.current.reason = undefined;
    this.publishQuestion();
    void this.generate('manual');
  }
  dismiss(id: string) {
    this.emit({
      type: 'session.status',
      sessionId: this.id,
      message: this.recent.some((r) => r.requestId === id) ? 'Suggestion dismissed.' : '',
    });
  }
  private cancelActive(reason: string) {
    if (!this.active) return;
    const old = this.active;
    this.active = undefined;
    old.controller.abort();
    this.log('generation.cancelled', {
      requestId: old.id,
      questionId: old.questionId,
      revision: old.revision,
      reason,
    });
    this.emit({
      type: 'recommendation.finished',
      sessionId: this.id,
      requestId: old.id,
      questionId: old.questionId,
      revision: old.revision,
      reason,
    });
  }
  /** A held draft may already be on screen as a preview, so its end is announced like a cancellation. */
  private discardDraft(reason: string) {
    const draft = this.draft;
    this.draft = undefined;
    if (!draft) return;
    const { id: requestId, questionId, revision } = draft.attempt;
    this.log('draft.discarded', { requestId, questionId, revision, reason });
    this.emit({
      type: 'recommendation.finished',
      sessionId: this.id,
      requestId,
      questionId,
      revision,
      reason,
    });
  }
  private reveal(attempt: Attempt, decision: Result) {
    const q = this.engine.current;
    if (this.stopped || attempt.controller.signal.aborted) return;
    if (!q || q.id !== attempt.questionId || q.revision !== attempt.revision) {
      // An explicit Answer Now is still delivered when the meeting moved on to another
      // question, or to more of this one, while the answer was being generated.
      if (attempt.mode === 'manual') this.revealDetached(attempt, decision);
      return;
    }
    const incompleteVerdict = decision.questionComplete === false && !attempt.acceptIncomplete;
    if (
      attempt.mode === 'automatic' &&
      (incompleteVerdict || (!attempt.previewed && (!this.canAuto() || !this.canFinalize)))
    ) {
      if (incompleteVerdict && this.canFinalize) {
        this.discardDraft('Question incomplete');
        this.engine.awaitingContinuation = true;
        this.lastProgress = Date.now();
        q.reason = 'Waiting for the rest of the question. You can also use Answer Now.';
        this.publishQuestion();
        this.scheduleContinuation(q);
      }
      return;
    }
    this.draft = undefined;
    q.state = 'QUESTION_COMPLETE';
    this.log('question.complete', { question: q.text, sourceAt: q.questionEndedAt });
    this.publishQuestion();
    if (decision.action === 'suggest')
      this.emitSuggestion(
        attempt,
        decision,
        q,
        (attempt.mode === 'manual' &&
          (!this.engine.finalized || this.engine.speaking || this.pendingCommits.size > 0)) ||
          decision.questionComplete === false,
      );
    else this.log('question.skipped', { requestId: attempt.id, question: q.text });
    this.engine.consume();
    if (decision.action === 'skip') {
      q.state = 'SKIPPED';
      q.reason =
        'Not addressed to you or not a substantive question. Use Answer Now to request an answer.';
    }
    this.publishQuestion();
  }
  /** Manual answer whose question the engine has since replaced or revised: delivered as asked. */
  private revealDetached(attempt: Attempt, decision: Result) {
    const question = {
      id: attempt.questionId,
      revision: attempt.revision,
      text: attempt.question,
    };
    if (decision.action === 'suggest')
      this.emitSuggestion(attempt, decision, question, decision.questionComplete === false);
    else
      this.log('question.skipped', {
        requestId: attempt.id,
        questionId: question.id,
        revision: question.revision,
        question: question.text,
      });
  }
  private emitSuggestion(
    attempt: Attempt,
    decision: Result,
    q: Pick<QuestionState, 'id' | 'revision' | 'text' | 'questionEndedAt'>,
    incomplete: boolean,
  ) {
    const suggestion: Suggestion = {
      ...decision,
      requestId: attempt.id,
      at: Date.now(),
      mode: attempt.mode,
      questionId: q.id,
      revision: q.revision,
      question: q.text,
      level: 'QUICK',
      questionEndedAt: q.questionEndedAt,
    };
    if (incomplete)
      suggestion.recommendation =
        'Incomplete question — confirm the meaning. ' + suggestion.recommendation;
    this.recent = [suggestion, ...this.recent].slice(0, 5);
    this.log('quick.ready', {
      requestId: attempt.id,
      questionId: q.id,
      revision: q.revision,
      answer: suggestion.suggestedResponse,
      question: q.text,
      sourceAt: q.questionEndedAt,
      claims: decision.projectClaims,
      facts: factsForProject(this.project).filter((f) => decision.groundedFactIds.includes(f.id)),
    });
    this.emit({ type: 'recommendation.ready', sessionId: this.id, suggestion });
  }
  /**
   * The generator judged a finalized question incomplete. If nothing more arrives within the
   * trailing silence, one more attempt answers the question as it stands, flagged as incomplete.
   */
  private scheduleContinuation(q: QuestionState) {
    clearTimeout(this.continuationTimer);
    const { revision } = q;
    const settle = this.engine.settleIn();
    this.continuationTimer = setTimeout(
      () => {
        if (
          this.stopped ||
          this.engine.current !== q ||
          q.revision !== revision ||
          !this.engine.awaitingContinuation ||
          this.active ||
          this.draft ||
          !this.canAuto() ||
          !this.canFinalize
        )
          return;
        this.engine.awaitingContinuation = false;
        this.log('question.settled', { question: q.text });
        void this.generate('automatic', true);
      },
      settle === Infinity ? LIMITS.trailingSettleMs : settle,
    );
  }
  /** Publish the unverified first candidate only if it could be revealed right now. */
  private preview(attempt: Attempt, draft: Result) {
    const q = this.engine.current;
    if (
      this.stopped ||
      this.active !== attempt ||
      attempt.controller.signal.aborted ||
      draft.action !== 'suggest' ||
      !q ||
      q.id !== attempt.questionId ||
      q.revision !== attempt.revision ||
      (attempt.mode === 'automatic' && (!this.canAuto() || !this.canFinalize))
    )
      return;
    attempt.previewed = true;
    this.log('preview.shown', { requestId: attempt.id, answer: draft.suggestedResponse });
    this.emit({
      type: 'recommendation.preview',
      sessionId: this.id,
      preview: {
        requestId: attempt.id,
        questionId: attempt.questionId,
        revision: attempt.revision,
        suggestedResponse: draft.suggestedResponse,
        recommendation: draft.recommendation,
        responseType: draft.responseType,
      },
    });
  }
  private async generate(mode: 'automatic' | 'manual', acceptIncomplete = false) {
    const q = this.engine.current;
    if (this.stopped || this.active || (mode === 'automatic' && !this.canAuto())) return;
    if (this.disabled || Date.now() < this.retryUntil) {
      this.emit({
        type: 'session.status',
        sessionId: this.id,
        message: this.disabled
          ? 'AI access unavailable. Fix configuration and restart.'
          : 'AI rate limit: please wait before retrying.',
      });
      return;
    }
    this.segments = pruneSegments(this.segments);
    if (!q || !this.segments.length) {
      this.emit({
        type: 'session.status',
        sessionId: this.id,
        message: 'Waiting for meeting speech before answering.',
      });
      return;
    }
    const attempt: Attempt = {
      id: crypto.randomUUID(),
      questionId: q.id,
      revision: q.revision,
      mode,
      question: q.text,
      controller: new AbortController(),
      acceptIncomplete,
    };
    q.reason = undefined;
    const snapshot = structuredClone({
      project: this.project,
      segments: this.segments,
      recent: this.recent,
      question: q.text,
      newSegmentIds: q.segmentIds,
    });
    this.active = attempt;
    this.log('context.prepared', {
      requestId: attempt.id,
      factsAvailable: factsForProject(snapshot.project).length,
    });
    if (mode === 'automatic' && !this.canFinalize) this.lastSpeculation = Date.now();
    this.log('generation.started', {
      requestId: attempt.id,
      question: q.text,
      model: this.model,
      promptVersion: PROMPT_VERSION,
    });
    this.emit({
      type: 'recommendation.started',
      sessionId: this.id,
      requestId: attempt.id,
      questionId: q.id,
      revision: q.revision,
      mode,
    });
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let speculationFailed = false;
    try {
      const result = await Promise.race([
        this.recommend(
          {
            ...snapshot,
            mode,
            audit: (event) =>
              this.log(event.kind, {
                requestId: attempt.id,
                questionId: attempt.questionId,
                revision: attempt.revision,
                reason:
                  event.reason ??
                  (event.review?.issues.length ? JSON.stringify(event.review.issues) : undefined),
                answer: event.decision?.suggestedResponse,
                claims: event.decision?.projectClaims,
                factsAvailable: factsForProject(snapshot.project).length,
                factsCited: event.decision?.groundedFactIds.length,
              }),
            level: 'QUICK',
            onPreview:
              (this.project.preferences?.previewUnverified ?? true)
                ? (draft) => this.preview(attempt, draft)
                : undefined,
          },
          attempt.controller.signal,
        ),
        new Promise<never>((_, reject) => {
          deadline = setTimeout(() => {
            attempt.controller.abort();
            reject(new Error('timeout'));
          }, LIMITS.requestMs);
        }),
      ]);
      if (this.stopped || this.active !== attempt || attempt.controller.signal.aborted) return;
      this.log('generation.ready', { requestId: attempt.id });
      // A previewed answer is not held back by new speech: the user already saw its draft.
      if (mode === 'manual' || this.canFinalize || attempt.previewed) this.reveal(attempt, result);
      else {
        this.draft = { attempt, result };
        this.advance();
      }
    } catch (error) {
      if (this.stopped || this.active !== attempt) return;
      const problem = safeError(error);
      // A single 400/404 (MODEL_CONFIGURATION) can be request-specific, so it must not
      // block Answer Now for the rest of the meeting; access and billing errors do.
      if (['API_ACCESS', 'API_BILLING'].includes(problem.code)) this.disabled = true;
      if (problem.retryAfterMs) this.retryUntil = Date.now() + problem.retryAfterMs;
      this.log('generation.failed', {
        requestId: attempt.id,
        reason: attempt.controller.signal.aborted ? 'TIMEOUT' : problem.code,
      });
      // A speculative attempt over a partial question is expendable: closing the question
      // here would also make the engine ignore the final transcript of the same segment.
      // The backoff is kept; the next transcript (or the backoff) starts a fresh attempt.
      if (mode === 'automatic' && !this.canFinalize && !this.disabled) {
        speculationFailed = true;
        return;
      }
      this.engine.consume();
      q.state = 'FAILED';
      q.reason = problem.message;
      this.publishQuestion();
      this.emit({
        type: 'session.error',
        sessionId: this.id,
        questionId: attempt.questionId,
        revision: attempt.revision,
        requestId: attempt.id,
        code: attempt.controller.signal.aborted ? 'TIMEOUT' : problem.code,
        message: attempt.controller.signal.aborted
          ? 'AI response timed out. Try Answer Now.'
          : problem.message,
        fatal: false,
        retryable: problem.retryable,
        retryAfterMs: problem.retryAfterMs,
      });
      // Retry only an explicit provider backoff; other failures wait for new input/manual action.
      // Its timer is separate from `timer`, which every transcript or speech event resets.
      if (problem.retryAfterMs && mode === 'automatic') {
        clearTimeout(this.retryTimer);
        this.retryTimer = setTimeout(() => {
          if (this.engine.current === q && !this.engine.awaitingNewTurn) {
            this.engine.retry();
            this.advance();
          }
        }, problem.retryAfterMs);
      }
    } finally {
      clearTimeout(deadline);
      if (this.active === attempt) {
        this.active = undefined;
        this.emit({
          type: 'recommendation.finished',
          sessionId: this.id,
          requestId: attempt.id,
          questionId: attempt.questionId,
          revision: attempt.revision,
          reason: '',
        });
      }
      // A manual attempt may have outlived its question; the current one still needs scheduling.
      if ((speculationFailed || mode === 'manual') && !this.stopped) this.advance();
    }
  }
  stop() {
    this.log('session.stopped');
    this.cancelActive('Stopped');
    const q = this.engine.current;
    if (q && !['ANSWERING', 'FAILED', 'SKIPPED', 'LISTENING'].includes(q.state)) {
      q.state = 'CANCELLED';
      q.reason = 'Meeting stopped.';
      this.publishQuestion();
    }
    this.stopped = true;
    clearInterval(this.expiry);
    clearTimeout(this.timer);
    clearTimeout(this.retryTimer);
    clearTimeout(this.continuationTimer);
    this.pendingCommits.clear();
    this.segments = [];
    this.recent = [];
    this.questions.clear();
    this.draft = undefined;
    this.engine.reset();
    this.project = { name: '', role: '', goal: '', context: '', keywords: [] };
  }
}
