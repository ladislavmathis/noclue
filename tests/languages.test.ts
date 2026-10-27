import { describe, it, expect } from 'vitest';
import { inspectQuestion, QuestionEngine } from '../packages/core/src/questions/engine';
import { transcriptionLanguages } from '../packages/core/src/realtime/transcriber';
import {
  SYSTEM_PROMPT,
  languageInstruction,
  systemPrompt,
} from '../packages/core/src/recommendations/provider';
import { PHRASES, phrasesFor } from '../packages/core/src/recommendations/phrases';
import {
  claimProblem,
  englishWording,
  fallback,
  isSafeTemplate,
  qualifyProposal,
  technicalQuestion,
} from '../packages/core/src/recommendations/quick';
import {
  ProjectSchema,
  SPOKEN_LANGUAGES,
  factsForProject,
  meetingLanguage,
  type Decision,
  type MeetingLanguage,
} from '../packages/shared/src/index';

const examples: Record<'sk' | 'cs' | 'de', { question: string; yesNo: string; statement: string }> =
  {
    sk: {
      question: 'Kedy začína pilotný projekt',
      yesNo: 'Môžete nám poslať cenovú ponuku',
      statement: 'Pilot začneme v marci s dvoma tímami',
    },
    cs: {
      question: 'Kolik bude stát pilotní projekt',
      yesNo: 'Můžete nám poslat cenovou nabídku',
      statement: 'Pilot začneme v březnu se dvěma týmy',
    },
    de: {
      question: 'Wann beginnt das Pilotprojekt',
      yesNo: 'Können Sie uns ein Angebot schicken',
      statement: 'Wir starten den Piloten im März mit zwei Teams',
    },
  };

describe('meeting language setting', () => {
  it('defaults to English for settings saved before languages existed', () => {
    const project = ProjectSchema.parse({
      name: 'P',
      role: '',
      goal: '',
      context: 'c',
      keywords: [],
    });
    expect(meetingLanguage(project)).toBe('en');
  });
  it('accepts every supported language and rejects others', () => {
    const preferences = {
      tone: 'professional',
      length: 'standard',
      strictContext: false,
      silenceMs: 700,
    };
    for (const language of ['en', 'sk', 'cs', 'de', 'auto'])
      expect(
        ProjectSchema.safeParse({
          name: 'P',
          role: '',
          goal: '',
          context: 'c',
          keywords: [],
          preferences: { ...preferences, language },
        }).success,
      ).toBe(true);
    expect(
      ProjectSchema.safeParse({
        name: 'P',
        role: '',
        goal: '',
        context: 'c',
        keywords: [],
        preferences: { ...preferences, language: 'fr' },
      }).success,
    ).toBe(false);
  });
});

describe('transcription languages', () => {
  it('sends the fixed meeting language', () => {
    expect(transcriptionLanguages('sk')).toEqual(['sk']);
    expect(transcriptionLanguages('de')).toEqual(['de']);
  });
  it('lists every supported language in automatic mode', () => {
    expect(transcriptionLanguages('auto')).toEqual(['en', 'sk', 'cs', 'de']);
  });
});

describe('question detection per language', () => {
  for (const [language, sample] of Object.entries(examples) as [
    'sk' | 'cs' | 'de',
    (typeof examples)['sk'],
  ][]) {
    it(`${language}: finds wh-questions and yes/no questions, not statements`, () => {
      expect(inspectQuestion(sample.question, language)).toEqual({
        candidate: true,
        complete: true,
      });
      expect(inspectQuestion(sample.yesNo, language).candidate).toBe(true);
      expect(inspectQuestion(sample.statement, language).candidate).toBe(false);
    });
    it(`${language}: a question mark from the transcriber always counts`, () => {
      expect(inspectQuestion(`${sample.statement}?`, language).candidate).toBe(true);
    });
    it(`${language}: automatic mode detects it too`, () => {
      expect(inspectQuestion(sample.question, 'auto').candidate).toBe(true);
      expect(inspectQuestion(sample.statement, 'auto').candidate).toBe(false);
    });
  }
  it('English detection is unchanged and still rejects unfinished clauses', () => {
    expect(inspectQuestion('What is the budget for the pilot', 'en')).toEqual({
      candidate: true,
      complete: true,
    });
    expect(inspectQuestion('What is the budget and', 'en').complete).toBe(false);
    expect(inspectQuestion('Kedy začína pilotný projekt', 'en').candidate).toBe(false);
  });
  it('a fixed non-English language ignores English cues', () => {
    expect(inspectQuestion('What is the budget', 'sk').candidate).toBe(false);
  });
  it('automatic mode does not read English statements as German or Czech questions', () => {
    for (const statement of [
      'It was a good quarter',
      'Our co-founder joined the call today',
      'Hat sizes vary across the team',
      'The team met in the lobby',
      'Revenue was up and the wo-man team grew',
    ])
      expect(inspectQuestion(statement, 'auto').candidate, statement).toBe(false);
  });
  it('short interrogatives still open a question, also after a filler', () => {
    for (const [text, language] of [
      ['Was kostet das Pilotprojekt', 'auto'],
      ['Und wie läuft die Integration', 'auto'],
      ['Wo starten wir den Piloten', 'de'],
      ['Takže čo ďalej', 'sk'],
      ['A čo rozpočet', 'auto'],
      ['Jak dlouho potrvá pilot', 'cs'],
      ['Hat das Team schon Feedback', 'auto'],
      ['Hat er Zeit am Montag', 'de'],
    ] as [string, MeetingLanguage][])
      expect(inspectQuestion(text, language).candidate, text).toBe(true);
  });
  it('relative uses of an interrogative are not questions', () => {
    for (const [text, language] of [
      ['Wie besprochen starten wir im März', 'de'],
      ['Ako sme sa dohodli, začneme v marci', 'sk'],
      ['Jak jsme říkali, začneme v březnu', 'cs'],
      ['Wie gesagt, das Budget steht', 'auto'],
    ] as [string, MeetingLanguage][])
      expect(inspectQuestion(text, language).candidate, text).toBe(false);
  });
  it('the question engine uses its language', () => {
    const engine = new QuestionEngine('de');
    const { question } = engine.update({
      id: 's1',
      sequence: 0,
      text: examples.de.question,
      at: Date.now(),
      final: true,
    });
    expect(question?.text).toContain('Pilotprojekt');
  });
});

describe('answer prompt language', () => {
  it('keeps the English prompt unchanged', () => {
    expect(systemPrompt('en')).toBe(SYSTEM_PROMPT);
    expect(languageInstruction('en')).toBe('');
  });
  it('asks for answers in a fixed language with English coaching', () => {
    expect(systemPrompt('sk')).toContain('concise Slovak answers');
    expect(languageInstruction('cs')).toContain('natural spoken Czech');
    expect(languageInstruction('de')).toContain('recommendation and missingInformation in English');
  });
  it('asks for the language of the question in automatic mode', () => {
    expect(systemPrompt('auto')).toContain('in the language of the question');
    expect(languageInstruction('auto')).toContain('language of latestQuestion');
  });
});

const decision: Decision = {
  action: 'suggest',
  responseType: 'answer',
  category: 'question',
  triggerSegmentIds: ['s1'],
  topicKey: 'pilot',
  recommendation: 'Say what you know.',
  suggestedResponse: 'x',
  groundedFactIds: [],
  missingInformation: [],
};

describe('localized spoken phrases', () => {
  it('every language has a full set', () => {
    for (const language of SPOKEN_LANGUAGES) {
      const p = PHRASES[language];
      expect(p.quick.length).toBe(PHRASES.en.quick.length);
      expect(p.technical.length).toBe(PHRASES.en.technical.length);
      expect(p.acknowledgement.length).toBe(PHRASES.en.acknowledgement.length);
      for (const text of [p.clarifyPoint, p.clarifyOption, p.noVerifiedInfo])
        expect(text).toBeTruthy();
    }
  });
  it("Slovak and Czech phrases do not assume the speaker's gender", () => {
    for (const language of ['sk', 'cs'] as const) {
      const p = PHRASES[language];
      for (const text of [
        ...p.quick,
        ...p.technical,
        ...p.acknowledgement,
        p.clarifyPoint,
        p.clarifyOption,
        p.noVerifiedInfo,
      ])
        expect(text).not.toMatch(/(?<!\p{L})(?:odpovedal|odpověděl|istý|jistý|rád|ráda)(?!\p{L})/u);
    }
  });
  it('automatic mode falls back to English phrases', () => {
    expect(phrasesFor('auto')).toBe(PHRASES.en);
  });
  for (const language of ['sk', 'cs', 'de'] as MeetingLanguage[])
    it(`${language}: fallbacks are spoken in the meeting language and skip review`, () => {
      const result = fallback(
        decision,
        'No support.',
        examples[language as 'sk'].question,
        language,
      );
      expect(PHRASES[language as 'sk'].quick).toContain(result.suggestedResponse);
      expect(isSafeTemplate(result.suggestedResponse)).toBe(true);
      const ack = fallback(decision, 'No support.', examples[language as 'sk'].statement, language);
      expect(PHRASES[language as 'sk'].acknowledgement).toContain(ack.suggestedResponse);
    });
});

describe('technical questions per language', () => {
  const technical = {
    sk: 'Ako máte vyriešenú bezpečnosť a šifrovanie dát',
    cs: 'Jak řešíte šifrování a bezpečnost dat',
    de: 'Wie ist die Architektur des Systems aufgebaut',
  };
  for (const language of ['sk', 'cs', 'de'] as const)
    it(`${language}: a technical question defers to the development team`, () => {
      expect(technicalQuestion(technical[language], language)).toBe(true);
      const result = fallback(decision, 'No support.', technical[language], language);
      expect(PHRASES[language].technical).toContain(result.suggestedResponse);
      expect(isSafeTemplate(result.suggestedResponse)).toBe(true);
    });
  it('institution names and business models are not technical', () => {
    expect(
      technicalQuestion('Kedy začína spolupráca s Technickou univerzitou v Košiciach', 'sk'),
    ).toBe(false);
    expect(technicalQuestion('Aký je váš obchodný model', 'sk')).toBe(false);
    expect(technicalQuestion('Jaký je váš obchodní model', 'cs')).toBe(false);
    expect(
      technicalQuestion('Wann starten Sie mit der Technischen Universität München', 'de'),
    ).toBe(false);
    expect(technicalQuestion('Wie sieht Ihr Geschäftsmodell aus', 'de')).toBe(false);
  });
  it('English stays English-only, automatic mode knows every language', () => {
    expect(technicalQuestion(technical.de, 'en')).toBe(false);
    expect(technicalQuestion(technical.de, 'auto')).toBe(true);
    const result = fallback(decision, 'No support.', technical.cs, 'auto');
    expect(PHRASES.en.technical).toContain(result.suggestedResponse);
  });
});

describe('English wording checks', () => {
  const project = (language: MeetingLanguage) => ({
    name: 'P',
    role: '',
    goal: '',
    context: '[CLAIM PLANNED | plan.pdf]\nThe pilot is planned for March.',
    keywords: [],
    preferences: {
      tone: 'professional' as const,
      length: 'standard' as const,
      strictContext: false,
      silenceMs: 700,
      language,
    },
  });
  const planned = (language: MeetingLanguage, text: string) => {
    const id = factsForProject(project(language))[0].id;
    return {
      ...decision,
      suggestedResponse: text,
      groundedFactIds: [id],
      projectClaims: [{ factId: id, status: 'PLANNED' as const }],
    };
  };
  it('detects English wording in automatic mode only when the answer is English', () => {
    expect(englishWording('We start the pilot in March.', 'auto')).toBe(true);
    expect(englishWording('Pilot začneme v marci.', 'auto')).toBe(false);
    expect(englishWording('Pilot začneme v marci.', 'en')).toBe(true);
    expect(englishWording('We start the pilot in March.', 'sk')).toBe(false);
  });
  it('does not count Slovak and Czech a, i, to as English', () => {
    expect(englishWording('Chceme to spustiť v marci a potom to overiť.', 'auto')).toBe(false);
    expect(englishWording('Chceme to spustit v březnu a pak to ověřit.', 'auto')).toBe(false);
    expect(englishWording('To je on a ja, i keď to nie je isté.', 'auto')).toBe(false);
    expect(englishWording('I think it is a good idea to start in March.', 'auto')).toBe(true);
  });
  it('leaves a Slovak answer alone in automatic mode', () => {
    const text = 'Pilot je naplánovaný na marec a potom to vyhodnotíme.';
    const answer = planned('auto', text);
    expect(claimProblem(answer, project('auto'))).toBeUndefined();
    expect(qualifyProposal(answer, project('auto')).suggestedResponse).toBe(text);
  });
  it('still demands planned wording from an English answer', () => {
    const answer = planned('en', 'The pilot starts in March.');
    expect(claimProblem(answer, project('en'))).toBe('Missing proposed or planned qualification');
    expect(qualifyProposal(answer, project('en')).suggestedResponse).toBe(
      'The proposed pilot starts in March.',
    );
  });
  it('does not demand English wording from a Slovak answer', () => {
    const answer = planned('sk', 'Pilot začne v marci.');
    expect(claimProblem(answer, project('sk'))).toBeUndefined();
    expect(qualifyProposal(answer, project('sk')).suggestedResponse).toBe('Pilot začne v marci.');
  });
});
