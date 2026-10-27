import {
  LIMITS,
  pruneSegments,
  type MeetingLanguage,
  type QuestionState,
  type Segment,
} from '@noclue/shared';

export const normalizeQuestion = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}']/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
/**
 * Words for the cue lookup below. Unlike normalizeQuestion, a hyphen between letters keeps the
 * word whole, so "co-founder" never reads as the Czech "co".
 */
const cueWords = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'-]/gu, ' ')
    .replace(/(?<!\p{L})-|-(?!\p{L})/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
/**
 * Question cues for the non-English meeting languages: interrogative words, request verbs
 * and auxiliaries that open a yes/no question. Matched by exact lookup in the word list from
 * cueWords. In automatic mode every utterance is checked against all three languages, so short
 * interrogatives that are also ordinary English or relative words (German "was", "wie", "wo",
 * "wer", Czech "co", "jak", Slovak "čo", "ako") count only when they open the utterance.
 */
const QUESTION_CUES: Record<'sk' | 'cs' | 'de', { anywhere: string[]; opening: string[] }> = {
  sk: {
    anywhere: [
      'prečo',
      'kto',
      'kedy',
      'kde',
      'ktorý',
      'ktorá',
      'ktoré',
      'ktorí',
      'koľko',
      'aký',
      'aká',
      'aké',
      'akí',
      'vysvetlite',
      'vysvetli',
      'popíšte',
      'popíš',
      'povedzte',
      'povedz',
      'predstavte',
    ],
    opening: [
      'čo',
      'ako',
      'môžete',
      'môžeš',
      'mohli',
      'viete',
      'vieš',
      'je',
      'sú',
      'máte',
      'máš',
      'bude',
      'budú',
      'boli',
      'bol',
      'bola',
      'plánujete',
      'chcete',
      'myslíte',
      'dá',
      'existuje',
      'či',
    ],
  },
  cs: {
    anywhere: [
      'proč',
      'kdo',
      'kdy',
      'kde',
      'který',
      'která',
      'které',
      'kteří',
      'kolik',
      'jaký',
      'jaká',
      'jaké',
      'jací',
      'vysvětlete',
      'vysvětli',
      'popište',
      'popiš',
      'řekněte',
      'řekni',
      'představte',
    ],
    opening: [
      'co',
      'jak',
      'můžete',
      'můžeš',
      'mohli',
      'víte',
      'víš',
      'je',
      'jsou',
      'máte',
      'máš',
      'bude',
      'budou',
      'byli',
      'byl',
      'byla',
      'plánujete',
      'chcete',
      'myslíte',
      'dá',
      'existuje',
      'zda',
      'jestli',
    ],
  },
  de: {
    anywhere: [
      'warum',
      'wieso',
      'weshalb',
      'wen',
      'wem',
      'wann',
      'woher',
      'wohin',
      'welche',
      'welcher',
      'welches',
      'welchen',
      'erklären',
      'erkläre',
      'beschreiben',
      'beschreibe',
      'erzählen',
      'erzähle',
    ],
    opening: [
      'was',
      'wie',
      'wo',
      'wer',
      'können',
      'kannst',
      'könnten',
      'könntest',
      'würden',
      'würdest',
      'werden',
      'wird',
      'haben',
      'hast',
      'hat',
      'ist',
      'sind',
      'gibt',
      'gab',
      'sollten',
      'sollen',
      'darf',
      'dürfen',
      'planen',
      'wollen',
      'ob',
    ],
  },
};
const FILLERS: Record<'sk' | 'cs' | 'de', string[]> = {
  sk: ['tak', 'takže', 'a', 'no', 'dobre', 'okej', 'vlastne'],
  cs: ['tak', 'takže', 'a', 'no', 'dobře', 'okej', 'vlastně'],
  de: ['also', 'und', 'dann', 'okay', 'gut', 'eigentlich', 'na'],
};
/** Openings that use an interrogative as a relative word: "Wie besprochen …", "Ako sme …". */
const NON_QUESTION_OPENINGS: Record<'sk' | 'cs' | 'de', string[]> = {
  sk: ['ako sme', 'ako bolo', 'ako som'],
  cs: ['jak jsme', 'jak bylo', 'jak jsem'],
  de: ['wie besprochen', 'wie gesagt', 'wie erwähnt', 'wie vereinbart', 'wie geplant'],
};
/**
 * German "hat" is also an English noun. In automatic mode it opens a question only when a
 * German subject follows ("Hat das Team …", "Hat er …").
 */
const GERMAN_SUBJECTS = [
  'er',
  'sie',
  'es',
  'man',
  'ihr',
  'das',
  'der',
  'die',
  'den',
  'dein',
  'euer',
  'unser',
  'jemand',
];
function cueCandidate(words: string[], language: 'sk' | 'cs' | 'de', auto = false) {
  const cues = QUESTION_CUES[language];
  if (words.some((w) => cues.anywhere.includes(w))) return true;
  const rest = FILLERS[language].includes(words[0]) ? words.slice(1) : words;
  if (!rest[0] || !cues.opening.includes(rest[0])) return false;
  if (auto && rest[0] === 'hat' && !GERMAN_SUBJECTS.includes(rest[1])) return false;
  const opening = rest.slice(0, 2).join(' ');
  return !NON_QUESTION_OPENINGS[language].includes(opening);
}
function englishInspection(normalized: string) {
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
    );
  return { candidate, incomplete };
}
// Fast provisional filter only. The generator supplies the semantic completeness
// verdict; neither punctuation nor ASR finalization alone authorizes publication.
// The English unfinished-clause check has no counterpart in the other languages, so there
// the generator's questionComplete verdict alone decides whether a question is finished.
export function inspectQuestion(text: string, language: MeetingLanguage = 'en') {
  const normalized = normalizeQuestion(text);
  const words = normalized.split(' ').filter(Boolean);
  const english =
    language === 'en' || language === 'auto' ? englishInspection(normalized) : undefined;
  const others =
    language === 'auto' ? (['sk', 'cs', 'de'] as const) : language === 'en' ? [] : [language];
  const cued = others.length ? cueWords(text) : [];
  const candidate =
    !!english?.candidate ||
    others.some((l) => cueCandidate(cued, l, language === 'auto')) ||
    text.includes('?');
  // In automatic mode the English check applies only when the text reads as English.
  const incomplete = !!english?.incomplete && (language === 'en' || english.candidate);
  return {
    candidate: candidate && words.length >= 2,
    complete: candidate && !incomplete && words.length >= 2,
  };
}
export class QuestionEngine {
  constructor(private language: MeetingLanguage = 'en') {}
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
        inspectQuestion(this.current.text, this.language).complete &&
        inspectQuestion(segment.text, this.language).candidate;
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
            inspectQuestion(this.current.text, this.language).complete &&
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
    const { complete, candidate } = inspectQuestion(this.current.text, this.language);
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
