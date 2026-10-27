import type { MeetingLanguage, SpokenLanguage } from '@noclue/shared';
/**
 * Application-owned sentences the user may say aloud, in every fixed meeting language.
 * Coaching and status text stay in English with the rest of the UI; only spoken wording is
 * localized. Automatic mode cannot know the language before the model answers, so it uses
 * English. Every sentence here is exempt from evidence review (see isSafeTemplate).
 */
export type Phrases = {
  /** No supported answer: ask for a repeat or a narrower question. */
  quick: readonly string[];
  /** Detailed technical question: defer to the development team. */
  technical: readonly string[];
  /** A statement, not a question: acknowledge it. */
  acknowledgement: readonly string[];
  clarifyPoint: string;
  clarifyOption: string;
  /** Strict context without supporting facts. Reviewed like a model answer, so not a template. */
  noVerifiedInfo: string;
};
export const PHRASES: Record<SpokenLanguage, Phrases> = {
  en: {
    quick: [
      'Could you say a bit more about what you have in mind? I want to give you a precise answer.',
      'Could you repeat the question? I want to make sure I address exactly what you are asking.',
      'That is a fair question. Which aspect matters most to you, so I can answer it precisely?',
      'Let me make sure I understand you correctly. Could you rephrase that for me?',
    ],
    technical: [
      'That is a detailed technical question. I would rather check it with our development team and come back to you with a precise answer.',
      'I do not want to guess on the technical details. Let me confirm that with our development team and follow up right after the call.',
    ],
    acknowledgement: [
      'Thank you, understood. Please reach out anytime if anything comes up on your side.',
      'Thank you, that works for us. Let us keep in touch on the next steps.',
    ],
    clarifyPoint:
      'Could you clarify which point you mean? I need a little more context to answer accurately.',
    clarifyOption:
      'Could you clarify which option you mean? I need that detail to answer accurately.',
    noVerifiedInfo:
      "I don't have verified information on that in my current notes, so I can't give a reliable answer yet.",
  },
  sk: {
    quick: [
      'Mohli by ste trochu priblížiť, čo presne máte na mysli? Chcem vám odpovedať presne.',
      'Mohli by ste otázku zopakovať? Chcem sa uistiť, že odpoviem presne na to, na čo sa pýtate.',
      'To je dobrá otázka. Ktorá časť je pre vás najdôležitejšia? Chcem odpovedať presne.',
      'Chcem mať istotu, že vám správne rozumiem. Mohli by ste to povedať inak?',
    ],
    technical: [
      'To je podrobná technická otázka. Radšej to overím s naším vývojovým tímom a ozvem sa vám s presnou odpoveďou.',
      'Pri technických detailoch nechcem hádať. Overím to s naším vývojovým tímom a ozvem sa hneď po stretnutí.',
    ],
    acknowledgement: [
      'Ďakujem, rozumiem. Ak by sa u vás niečo objavilo, kedykoľvek sa ozvite.',
      'Ďakujem, to nám vyhovuje. Ostaňme v kontakte ohľadom ďalších krokov.',
    ],
    clarifyPoint:
      'Mohli by ste upresniť, ktorý bod máte na mysli? Potrebujem trochu viac kontextu, aby bola moja odpoveď presná.',
    clarifyOption:
      'Mohli by ste upresniť, ktorú možnosť máte na mysli? Potrebujem to vedieť, aby bola moja odpoveď presná.',
    noVerifiedInfo:
      'K tomu nemám v poznámkach overené informácie, takže zatiaľ nemôžem dať spoľahlivú odpoveď.',
  },
  cs: {
    quick: [
      'Mohli byste trochu přiblížit, co přesně máte na mysli? Chci vám odpovědět přesně.',
      'Mohli byste otázku zopakovat? Chci se ujistit, že odpovím přesně na to, na co se ptáte.',
      'To je dobrá otázka. Která část je pro vás nejdůležitější? Chci odpovědět přesně.',
      'Chci mít jistotu, že vám správně rozumím. Mohli byste to říct jinak?',
    ],
    technical: [
      'To je podrobná technická otázka. Raději to ověřím s naším vývojovým týmem a ozvu se vám s přesnou odpovědí.',
      'U technických detailů nechci hádat. Ověřím to s naším vývojovým týmem a ozvu se hned po schůzce.',
    ],
    acknowledgement: [
      'Děkuji, rozumím. Kdyby se u vás něco objevilo, kdykoli se ozvěte.',
      'Děkuji, to nám vyhovuje. Zůstaňme v kontaktu ohledně dalších kroků.',
    ],
    clarifyPoint:
      'Mohli byste upřesnit, který bod máte na mysli? Potřebuji trochu více kontextu, aby byla moje odpověď přesná.',
    clarifyOption:
      'Mohli byste upřesnit, kterou možnost máte na mysli? Potřebuji to vědět, aby byla moje odpověď přesná.',
    noVerifiedInfo:
      'K tomu nemám v poznámkách ověřené informace, takže zatím nemohu dát spolehlivou odpověď.',
  },
  de: {
    quick: [
      'Könnten Sie etwas genauer sagen, was Sie meinen? Ich möchte Ihnen eine präzise Antwort geben.',
      'Könnten Sie die Frage bitte wiederholen? Ich möchte genau auf das eingehen, was Sie fragen.',
      'Das ist eine berechtigte Frage. Welcher Aspekt ist Ihnen am wichtigsten, damit ich präzise antworten kann?',
      'Ich möchte sicher sein, dass ich Sie richtig verstehe. Könnten Sie das anders formulieren?',
    ],
    technical: [
      'Das ist eine detaillierte technische Frage. Ich kläre das lieber mit unserem Entwicklungsteam und melde mich mit einer genauen Antwort.',
      'Bei den technischen Details möchte ich nicht raten. Ich kläre das mit unserem Entwicklungsteam und melde mich direkt nach dem Termin.',
    ],
    acknowledgement: [
      'Vielen Dank, verstanden. Melden Sie sich gern jederzeit, falls bei Ihnen etwas aufkommt.',
      'Vielen Dank, das passt für uns. Bleiben wir zu den nächsten Schritten in Kontakt.',
    ],
    clarifyPoint:
      'Könnten Sie präzisieren, welchen Punkt Sie meinen? Ich brauche etwas mehr Kontext, um genau zu antworten.',
    clarifyOption:
      'Könnten Sie präzisieren, welche Option Sie meinen? Das brauche ich, um genau zu antworten.',
    noVerifiedInfo:
      'Dazu habe ich in meinen Notizen keine bestätigten Informationen, deshalb kann ich noch keine verlässliche Antwort geben.',
  },
};
export const phrasesFor = (language: MeetingLanguage = 'en'): Phrases =>
  PHRASES[language === 'auto' ? 'en' : language];
/** Every application-owned spoken sentence in every language. */
export const ALL_PHRASES: readonly string[] = Object.values(PHRASES).flatMap((p) => [
  ...p.quick,
  ...p.technical,
  ...p.acknowledgement,
  p.clarifyPoint,
  p.clarifyOption,
]);
