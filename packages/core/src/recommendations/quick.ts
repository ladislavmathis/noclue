import {
  factsForProject,
  meetingLanguage,
  type Decision,
  type MeetingLanguage,
  type Project,
  type QuickDecision,
} from '@noclue/shared';
import { inspectQuestion } from '../questions/engine.js';
import { ALL_PHRASES, PHRASES, phrasesFor } from './phrases.js';
/**
 * Spoken when no supported answer could be verified: a polite request to repeat or narrow the
 * question keeps the floor without guessing. Varied by topic so repeated gaps do not sound canned.
 * English versions; every meeting language has its own set in phrases.ts.
 */
export const QUICK_FALLBACKS = PHRASES.en.quick;
/** For detailed technical questions the honest move is to defer to the development team. */
export const TECHNICAL_FALLBACKS = PHRASES.en.technical;
/** A statement rather than a question deserves an acknowledgment, not a request to repeat it. */
export const ACKNOWLEDGEMENT_FALLBACKS = PHRASES.en.acknowledgement;
export const ALL_FALLBACKS = [
  ...QUICK_FALLBACKS,
  ...TECHNICAL_FALLBACKS,
  ...ACKNOWLEDGEMENT_FALLBACKS,
];
/**
 * The wording checks below match English phrases. In a fixed non-English meeting they would
 * misfire (an answer can never contain "proposed"), so they run only for English answers.
 * In automatic mode the answer itself decides: it counts as English when common English
 * function words make up a clear share of it.
 */
export function englishWording(text: string, language: MeetingLanguage) {
  if (language === 'en') return true;
  if (language !== 'auto') return false;
  const words = text.toLowerCase().match(/\p{L}+/gu) ?? [];
  const english = words.filter((w) =>
    /^(?:the|a|an|and|or|is|are|was|were|we|i|you|it|to|of|in|on|for|with|that|this|have|has|not|be|will|would|can|could)$/.test(
      w,
    ),
  ).length;
  return words.length > 0 && english / words.length >= 0.2;
}
export const QUICK_FALLBACK = QUICK_FALLBACKS[0];
const TECHNICAL_TERMS =
  /\b(?:architecture|algorithm|api|apis|latency|throughput|accuracy|precision|recall|benchmark|benchmarks|dataset|datasets|training|inference|implementation|implemented|integration|integrated|encryption|encrypted|security|infrastructure|pipeline|ontology|framework|protocol|database|deployment|deployed|scalability|source code|software|hardware|technical|technically|parameters|metrics|neural|llm|llms|transformer|embedding|embeddings|vector|tokens|gpu|compute|model|models|detection|detector|classifier|fine-?tun\w*|hallucinat\w*|retriev\w*)\b/i;
/** Institution names ("University of Technology", "Technical University") are not technical content. */
export function technicalQuestion(question: string | undefined) {
  if (!question) return false;
  const text = question
    .replace(/\b(?:university|institute|academy) of technology\b/gi, ' ')
    .replace(/\btechnical university\b/gi, ' ')
    .replace(/\bbusiness model\b/gi, ' ');
  return TECHNICAL_TERMS.test(text);
}
const pickFallback = (key: string, options: readonly string[]) => {
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return options[hash % options.length];
};
export function speakable(text: string) {
  const words = text.match(/\b[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)*\b/gu) ?? [];
  const sentences = text.split(/[.!?]+(?:\s|$)/).filter((s) => s.trim());
  return words.length >= 1 && sentences.length <= 3;
}
export function fallback(
  decision: Decision & Partial<QuickDecision>,
  reason: string,
  question?: string,
  language: MeetingLanguage = 'en',
) {
  const technical = technicalQuestion(question);
  const statement = !!question?.trim() && !inspectQuestion(question, language).candidate;
  const phrases = phrasesFor(language);
  return {
    ...decision,
    action: 'suggest' as const,
    responseType: 'answer' as const,
    category: 'question' as const,
    answerBasis: 'insufficient' as const,
    suggestedResponse: pickFallback(
      decision.topicKey || decision.suggestedResponse,
      statement ? phrases.acknowledgement : technical ? phrases.technical : phrases.quick,
    ),
    recommendation: statement
      ? 'No question was asked: acknowledge briefly and keep the floor.'
      : technical
        ? 'No verified answer yet: defer to the development team and note the question for follow-up.'
        : 'No verified answer yet: ask politely for a repeat or clarification, then confirm the details after the call.',
    groundedFactIds: [],
    projectClaims: [],
    missingInformation: [reason],
  };
}
export function claimProblem(
  decision: Decision & Partial<QuickDecision>,
  project: Project,
): string | undefined {
  const facts = new Map(factsForProject(project).map((f) => [f.id, f]));
  const ranks = { PROPOSED: 0, PLANNED: 1, IMPLEMENTED: 2, TESTED: 3, VALIDATED: 4 };
  const projectIds = decision.groundedFactIds.filter((id) => !id.startsWith('personal-'));
  const claims = decision.projectClaims ?? [];
  if (projectIds.some((id) => !claims.some((c) => c.factId === id)))
    return 'Missing project claim metadata';
  for (const claim of claims) {
    const fact = facts.get(claim.factId);
    if (!fact || !projectIds.includes(claim.factId)) return 'Unknown or unused claim source';
    if (claim.status !== null && (fact.status === null || ranks[claim.status] > ranks[fact.status]))
      return 'Claim status exceeds its evidence';
  }
  // Everything below inspects English wording.
  if (!englishWording(decision.suggestedResponse, meetingLanguage(project))) return undefined;
  if (
    /\bwe (?:have )?(?:not|never) (?:conducted|run|completed|performed)\b/i.test(
      decision.suggestedResponse,
    )
  )
    return 'Unsupported denial of past activity; missing results do not prove no activity occurred';
  const evidence = decision.groundedFactIds.map((id) => facts.get(id)?.text ?? '').join(' ');
  const personalEvidence = decision.groundedFactIds
    .filter((id) => id.startsWith('personal-'))
    .map((id) => facts.get(id)?.text ?? '')
    .join(' ');
  // Only a first-person clause claims a personal responsibility ("I coordinate…", "my role is to
  // lead…"). The same verb about the other party ("which parts you've managed") or about the
  // company ("we support the partners") is not a personal claim.
  if (!/\bI (?:would|could|might)\b/i.test(decision.suggestedResponse)) {
    const firstPersonDuty =
      /\b(?:I(?:'(?:ll|d|ve|m))?|my \w+(?: \w+)?)\s+(?:\w+\s+){0,2}(oversee|manag|lead|supervis|align|ensur|coordinat|support)\w*/gi;
    for (const match of decision.suggestedResponse.matchAll(firstPersonDuty)) {
      if (!new RegExp(`\\b${match[1]}\\w*`, 'i').test(personalEvidence))
        return 'A personal responsibility is not established by the confirmed personal facts. Keep only the explicitly confirmed responsibilities and state which details are missing.';
    }
  }
  const humanNextSteps =
    /\b(?:recommend(?:s|ed|ing)?|propos(?:e|es|ing)|suggest(?:s|ed|ing)?)\b[^.!?]{0,45}\b(?:next steps|verification actions)\b[^.!?]{0,45}\b(?:to|for) (?:the )?(?:human|reviewer|user)\b|\b(?:guide|guides|guiding) (?:human )?(?:reviewer|user)s?\b[^.!?]{0,50}\bnext steps\b|\b(?:human )?(?:reviewer|user)s?\b[^.!?]{0,60}\b(?:suggested|recommended) verification actions\b/i;
  const postAbstention = /\b(?:after|beyond|following) (?:an? )?abstention\b/i;
  const gap =
    /\b(?:not documented|undocumented|not specified|does not specify|unclear|unconfirmed)\b/i;
  if (
    projectIds.length &&
    !gap.test(decision.suggestedResponse) &&
    ((humanNextSteps.test(decision.suggestedResponse) && !humanNextSteps.test(evidence)) ||
      (postAbstention.test(decision.suggestedResponse) && !postAbstention.test(evidence)))
  )
    return 'Verification planning does not establish user-facing recommendations after abstention. Describe documented planning and evidence outputs separately; explicitly state that the post-abstention recommendations are not documented.';
  // Conservative checks for known semantic escalations, regardless of model approval.
  // Only reject when the concept is absent from the cited evidence, not merely unqualified.
  const deniesNextSteps =
    /\b(?:does not|doesn't|cannot|can't|never)\s+(?:\w+\s+){0,2}(?:recommend|propose|suggest)\b/i;
  if (
    projectIds.length &&
    deniesNextSteps.test(decision.suggestedResponse) &&
    !deniesNextSteps.test(evidence)
  )
    return 'Missing documentation does not prove the system cannot recommend or propose steps. State that this behavior is not documented, rather than denying the capability.';
  if (projectIds.length) {
    for (const concept of [
      /\boptimi[sz]\w*/i,
      /\bminimi[sz]\w*/i,
      /\bguarantee\w*/i,
      /\baccountab\w*/i,
      /\bcertif\w*/i,
      /\bcomplian\w*/i,
    ]) {
      if (concept.test(decision.suggestedResponse) && !concept.test(evidence))
        return 'The answer adds a benefit, guarantee or mechanism not established by the cited evidence';
    }
  }
  const comparisonViaAblation =
    /\bcompar(?:e|es|ing|ison)\b[^.!?]*\b(?:through|via|using|by means of)\b[^.!?]*\bablation\b/i;
  const ablationForComparison = /\bablation\b[^.!?]*\bto compare\b/i;
  if (
    projectIds.length &&
    [comparisonViaAblation, ablationForComparison].some(
      (relation) => relation.test(decision.suggestedResponse) && !relation.test(evidence),
    )
  )
    return 'The cited evidence does not establish ablation as the method for comparing workflows; state the two methods separately';
  // A schema-valid status does not make overconfident spoken wording safe.
  const unproven = claims.some((c) => !c.status || ranks[c.status] < 2);
  if (
    unproven &&
    /\b(we (?:have )?(?:implemented|validated|tested|deployed)|currently supports|results (?:show|demonstrate)|testing showed|achieved|proven)\b/i.test(
      decision.suggestedResponse,
    )
  )
    return 'Overconfident wording';
  if (
    claims.some((c) => c.status === 'PROPOSED' || c.status === 'PLANNED') &&
    !/\b(propos\w*|planned|planning|(?:we |is |are )plan|aims? to|intended|intend to|expected (?:outcome|research outcome|to)|would|could|envisaged|targeting|not yet)\b/i.test(
      decision.suggestedResponse,
    )
  )
    return 'Missing proposed or planned qualification';
  return undefined;
}

export function validateClaims(decision: Decision & Partial<QuickDecision>, project: Project) {
  return claimProblem(decision, project) === undefined;
}
export function qualifyProposal(decision: Decision & Partial<QuickDecision>, project: Project) {
  // Only repair missing qualification after IDs and declared maturity passed.
  // This cannot turn a rejected achieved/validated claim into an allowed claim.
  const problem = claimProblem(decision, project);
  const sourceDeclaresDraft =
    /(?:supplied (?:file|document)|this (?:file|document)) is an? (?:internal )?(?:scientific )?draft\b/i.test(
      project.context,
    );
  const needsSourceQualification =
    !problem &&
    sourceDeclaresDraft &&
    decision.groundedFactIds.some((id) => !id.startsWith('personal-')) &&
    !/\b(proposed|proposal|planned|aims? to|intended|would|could|in the draft|according to the draft)\b/i.test(
      decision.suggestedResponse,
    );
  if (problem !== 'Missing proposed or planned qualification' && !needsSourceQualification)
    return decision;
  // The automatic prefix is English; other languages get it from the prompt instead.
  if (!englishWording(decision.suggestedResponse, meetingLanguage(project))) return decision;
  const text = decision.suggestedResponse;
  return {
    ...decision,
    suggestedResponse: /^The /i.test(text)
      ? text.replace(/^The /i, 'The proposed ')
      : `In the proposal, ${text.replace(/^[A-Z][a-z]+\b/, (word) => word.toLowerCase())}`,
  };
}
export function protectPersonalDraft(decision: Decision & Partial<QuickDecision>) {
  // Only first-person wording can be invented personal history. A position stated for the
  // project ("we are open to…") stays a draft and is judged by the evidence review instead.
  if (
    decision.responseType !== 'draft' ||
    !/\b(?:I|I'm|I've|I'd|me|my|myself)\b/i.test(decision.suggestedResponse)
  )
    return decision;
  // Missing responsibilities are not handled here: an introduction that mentions a role is
  // checked sentence by sentence by claimProblem() and the evidence review, which repair or
  // reject only the unsupported part instead of replacing the whole answer with a template.
  // Uncertain addressee drafts can still contain supported answers. This guard
  // is for missing biography explicitly acknowledged by the generator itself.
  if (
    decision.responseType === 'draft' &&
    decision.missingInformation.some((text) => /motivation|reason.*join/i.test(text))
  )
    return {
      ...decision,
      suggestedResponse:
        '[Explain your real reason for joining this project, using only details that are true for you.]',
      recommendation:
        'Fill in your actual motivation before using this draft. Do not read the placeholder aloud.',
      groundedFactIds: [],
      projectClaims: [],
    };
  const missingExperience = decision.missingInformation.some((text) =>
    /experience|background|career|teams? .*managed|previous|prior|achievement/i.test(text),
  );
  if (decision.responseType !== 'draft' || !missingExperience) return decision;
  return {
    ...decision,
    suggestedResponse:
      '[Describe your verified experience and one real example; if you have none, say so.]',
    recommendation:
      'Fill in your own verified details before using this draft. Do not read the placeholder aloud.',
    groundedFactIds: [],
    projectClaims: [],
  };
}

export function lengthProblem(text: string): string | undefined {
  if (speakable(text)) return undefined;
  const count = (text.match(/\b[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)*\b/gu) ?? []).length;
  return `Candidate has ${count} words. Rewrite it to 1–3 short sentences without adding claims. Do not return unchanged text.`;
}
export function currentQuestion(text: string) {
  // Explicit corrections replace the abandoned question, retaining original transcript elsewhere.
  const parts = text.split(/\b(?:actually|instead|let me rephrase)\s*[,;:]?\s*/i);
  const replacement = parts.at(-1)?.trim();
  return parts.length > 1 &&
    replacement &&
    /^(?:what|when|where|why|how|who|which|is|are|can|could|do|does|will|would)\b/i.test(
      replacement,
    )
    ? replacement
    : text;
}

// Only exact application-owned text bypasses model review, never a responseType or empty citations.
export function isSafeTemplate(text: string) {
  return new Set([
    ...ALL_PHRASES,
    'My specific responsibilities are not documented in these notes, so I need to confirm them.',
    '[Explain your real reason for joining this project, using only details that are true for you.]',
    '[Describe your verified experience and one real example; if you have none, say so.]',
  ]).has(text);
}
