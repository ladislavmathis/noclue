# Changelog

Verzia aplikácie sa zobrazuje v pravom dolnom rohu bočného panela, nastavení aj cue okna.
Jediný zdroj verzie je `package.json`; `APP_VERSION` v `packages/shared` a `manifest.json`
musia mať rovnakú hodnotu (stráži to `tests/version.test.ts`).

Číslovanie: **MAJOR.MINOR.PATCH** — PATCH pre opravy, MINOR pre nové funkcie, MAJOR pre
nekompatibilné zmeny. Pri každej verzii pribudne záznam sem a git tag `vX.Y.Z`.

## Unreleased

- Verejné podklady obsahujú iba noclue; odstránený je nesúvisiaci katalóg značiek a interné
  poznámky spred prvej verejnej verzie.
- Cue sleduje zdieľanie od načítania stránky Meet/Teams a obnoví jeho stav pri otvorení alebo
  opätovnom otvorení. Karty otvorené pred aktualizáciou treba obnoviť; bez detekcie sa cue
  nezobrazí. Detekcia je best effort a nevzťahuje sa na zdieľanie z iných aplikácií.
- Neoverené náhľady sú predvolene vypnuté. Výslovná voľba používateľa zostáva zachovaná;
  pokyny aj verejné texty vysvetľujú limity AI kontroly.
- Stop vymaže aj testový záznam v pamäti. Export treba spraviť pred zastavením; už stiahnuté
  súbory zostávajú používateľovi.
- Web odkazuje na GitHub beta download s návodom. Release dokumentácia zodpovedá verejnému
  repozitáru a release workflow vyžaduje browser testy pred publikovaním.
- Diagnostická konzola neukladá voľný text z AI kontroly. Kontrola secretov zachytáva aj
  ďalšie typy tokenov, vnorené `.env` súbory a kľúče za testovacími hodnotami.
- Vitest aktualizovaný na 4.1.12 kvôli oprave zraniteľností vo vývojových závislostiach.

## 0.5.0 — 20. 10. 2026

- **Jazyk meetingu:** angličtina, slovenčina, čeština, nemčina alebo Automaticky. Nastavuje sa v
  Response preferences. Prepis dostane jazyk ako očakávaný vstup, odpovede sa píšu v jazyku
  meetingu, tipy a rozhranie ostávajú anglicky. Automaticky odpovedá v jazyku otázky.
- **Rozpoznanie otázok** má slovenské, české a nemecké opytovacie slová. Anglická kontrola
  nedokončenej vety beží len pre angličtinu.
- **Náhradné vety** (požiadanie o zopakovanie, odklad technickej otázky, poďakovanie,
  upresnenie) sú preložené do všetkých jazykov. Kontroly anglických formulácií bežia len pri
  anglických odpovediach. Fact-check porovnáva význam naprieč jazykmi.
- **Cue okno mimo zdieľania:** tlačidlo Pop out presunie cue do samostatného plávajúceho okna
  (Document Picture-in-Picture), ktoré zdieľanie karty ani okna nezachytí. Pri zdieľaní
  spustenom zo stránky meetingu sa cue v stránke skryje a pri zdieľaní celej obrazovky aj
  plávajúce okno. Po skončení zdieľania sa vráti.
- Prompt `quick-b2-v05.0-languages`, fact-check `evidence-review-v4.5-languages`.

## 0.4.0 — 20. 10. 2026

Prvá verejná verzia pod názvom **noclue by ignition**. Protokol 5. Nekompatibilné so starým
backendom: server už neexistuje.

- **Bez servera:** celá logika (prepis, otázky, odpovede, fact-check) beží priamo v rozšírení.
  Netreba Node.js, terminál, `.env`, párovací token ani `ignition-connection.json`.
- **Vlastný API kľúč (BYOK):** kľúč sa vkladá v rozšírení a ukladá len v `chrome.storage.local`.
  Prepis ide priamo na OpenAI realtime (kľúč v WebSocket subprotokole), odpovede priamo na
  OpenAI alebo Anthropic. Test kľúča je bezplatný (číta len detail modelu).
- **Anthropic ako poskytovateľ odpovedí a fact-checku:** Claude Opus 5.5, Sonnet 5.5 alebo
  Haiku 5.5, structured output, nízke `effort` kvôli latencii. Prepis ostáva na OpenAI.
- **Sprievodca pri inštalácii:** kľúče, mikrofón a vysvetlenie toku dát so súhlasom. Start je
  dostupný až po dokončení sprievodcu.
- **Nová značka:** logo, farby, písma Anta a Manrope (pribalené lokálne) a tón podľa dizajn
  manuálu noclue. Svetlá a tmavá téma panelu, tmavé cue okno.
- **Testy:** browser testy bežia na testovacom builde (`npm run build:test`), ktorý sa pripája
  na lokálny testovací hub s falošnými AI poskytovateľmi. Produkčný build nemá localhost
  oprávnenie.
