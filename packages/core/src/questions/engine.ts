import { LIMITS, pruneSegments, type QuestionState, type Segment } from '@noclue/shared';

export const normalizeQuestion = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}']/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
// Fast provisional filter only. The generator supplies the semantic completeness
// verdict; neither punctuation nor ASR finalization alone authorizes publication.
export function inspectQuestion(text: string) {
  const normalized = normalizeQuestion(text);
  const words = normalized.split(' ').filter(Boolean);
  const strandedPreposition = /\b(what|which|who)\b.+\b(for|to|with|about|of)$/.test(normalized);
  const incomplete =
    !strandedPreposition &&
    !/\bas (?:it )?is$/.test(normalized) &&
    /\b(to|and|or|because|if|about|the|a|an|with|does|is|are|of|for|by|versus|than|how|why|what|which|when|where|who)\s*$/i.test(
      normalized,
    );
  const candidate =
    /\b(what|why|how|who|when|where|which|tell|explain|describe|introduce)\b/i.test(normalized) ||
    /^(?:(?:well|so|and|okay|actually) )?(can|could|would|will|should|do|does|did|is|are|have|has)\b/i.test(
      normalized,
    ) ||
    /^(?:in|for|with|regarding|given|at|on)\b.{0,180}\b(?:can|could|would|will|should|do|does|did|is|are|have|has)\s+(?:the|this|that|your|our|it|you|we|they|a|an)\b/i.test(
      normalized,
    ) ||
    text.includes('?');
  return {
    candidate: candidate && words.length >= 2,
    complete: candidate && !incomplete && words.length >= 2,
  };
}
export class QuestionEngine {
  current?: QuestionState;
  private parts = new Map<string, Segment>();
  private consumed = new Set<string>();
  private ended = false;
  awaitingContinuation = false;
  awaitingNewTurn = false;
  private speechStart?: number;
  private speechEnd?: number;
  speaking = false;
  speechKnown = false;
  update(segment: Segment): { changed: boolean; question?: QuestionState } {
    const known = this.parts.get(segment.id);
    if (this.consumed.has(segment.id)) {
      // A segment consumed while still partial (Answer Now, a pipeline failure) keeps
      // updating its question, and new words reopen the question for an automatic answer.
      if (!known || known.final || !this.current) return { changed: false, question: this.current };
      if (normalizeQuestion(known.text) !== normalizeQuestion(segment.text)) this.ended = false;
    } else {
      // A new finalized question after an ended turn is a new event even while
      // the previous answer is pending or failed. Continuation fragments still merge.
      const newQuestion =
        !known &&
        this.current &&
        this.finalized &&
        !this.speaking &&
        inspectQuestion(this.current.text).complete &&
        inspectQuestion(segment.text).candidate;
      if ((newQuestion || (this.awaitingNewTurn && !known)) && !this.ended) this.consume();
      if (this.ended) {
        this.parts.clear();
        this.current = undefined;
        this.ended = false;
        this.awaitingNewTurn = false;
      }
    }
    this.parts.set(segment.id, segment);
    this.parts = new Map(pruneSegments([...this.parts.values()]).map((s) => [s.id, s]));
    const text = [...this.parts.values()]
      .sort((a, b) => a.sequence - b.sequence)
      .map((s) => s.text)
      .join(' ')
      .trim();
    const changed = normalizeQuestion(text) !== normalizeQuestion(this.current?.text ?? '');
    if (!this.current)
      this.current = {
        id: crypto.randomUUID(),
        revision: 0,
        text: '',
        segmentIds: [],
        state: 'LISTENING',
        speechStartedAt: this.speechStart,
        questionEndedAt: this.speechEnd,
      };
    this.current.text = text;
    this.current.segmentIds = [...this.parts.keys()];
    if (changed) this.current.revision++;
    this.refresh();
    return { changed, question: this.current };
  }
  speech(active: boolean, speechAt: number) {
    this.speechKnown = true;
    this.speaking = active;
    if (active) {
      // Retain the last question for Answer Now until new transcript text
      // arrives. VAD alone must not create a window with a stale UI question ID.
      // A breath-length pause inside an unanswered question is not a new turn: speakers
      // often finish a complete-sounding clause and then add its object ("…or multimodal X").
      const pause = speechAt - (this.speechEnd ?? -Infinity);
      if (
        this.current &&
        this.finalized &&
        (this.ended ||
          (!this.awaitingContinuation &&
            inspectQuestion(this.current.text).complete &&
            pause >= LIMITS.continuationMs))
      )
        this.awaitingNewTurn = true;
      this.speechStart = speechAt;
      this.speechEnd = undefined;
      if (this.current && !this.ended && !this.awaitingNewTurn) {
        this.current.speechStartedAt ??= speechAt;
        this.current.questionEndedAt = undefined;
      }
    } else {
      this.speechEnd = speechAt;
      if (this.current && !this.ended && !this.awaitingNewTurn)
        this.current.questionEndedAt = speechAt;
    }
    this.refresh();
  }
  get finalized() {
    return this.parts.size > 0 && [...this.parts.values()].every((s) => s.final);
  }
  get mayComplete() {
    if (!this.current || this.ended || this.awaitingNewTurn || !this.finalized || this.speaking)
      return false;
    const { complete, candidate } = inspectQuestion(this.current.text);
    return complete || (candidate && this.settleIn() === 0);
  }
  /**
   * Ms of further silence before a final question that only looks unfinished (trailing "is",
   * "for", …) may complete; the generator's questionComplete verdict still applies.
   */
  settleIn() {
    if (this.speechEnd === undefined || this.speaking) return Infinity;
    return Math.max(0, this.speechEnd + LIMITS.trailingSettleMs - Date.now());
  }
  refresh() {
    if (!this.current || this.ended) return;
    this.current.state = this.mayComplete ? 'QUESTION_LIKELY_COMPLETE' : 'QUESTION_FORMING';
  }
  consume() {
    for (const id of this.parts.keys()) this.consumed.add(id);
    while (this.consumed.size > 1000) this.consumed.delete(this.consumed.values().next().value!);
    this.ended = true;
    this.awaitingContinuation = false;
    this.awaitingNewTurn = false;
    if (this.current) this.current.state = 'ANSWERING';
  }
  retry() {
    this.ended = false;
    this.refresh();
  }
  abandon() {
    this.consume();
    this.current = undefined;
  }
  reset() {
    this.current = undefined;
    this.parts.clear();
    this.consumed.clear();
    this.ended = false;
    this.awaitingNewTurn = false;
    this.awaitingContinuation = false;
    this.speechStart = undefined;
    this.speechEnd = undefined;
  }
}
