# Changelog

Verzia aplikácie sa zobrazuje v pravom dolnom rohu bočného panela, nastavení aj cue okna.
Jediný zdroj verzie je `package.json`; `APP_VERSION` v `packages/shared` a `manifest.json`
musia mať rovnakú hodnotu (stráži to `tests/version.test.ts`).

Číslovanie: **MAJOR.MINOR.PATCH** — PATCH pre opravy, MINOR pre nové funkcie, MAJOR pre
nekompatibilné zmeny. Pri každej verzii pribudne záznam sem a git tag `vX.Y.Z`.

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

## 0.3.5 — 19. 10. 2026

Opravy generovania cues z code review 19. 10. (`docs/CODE_REVIEW_2026-10-19.md`). Protokol 4
zostáva; reštartuj backend a po builde znova načítaj rozšírenie (zmena v offscreen stránke).

- **Microsoft Teams vo webe:** rozšírenie sa dá spustiť aj na tabe Teams v Chrome
  (teams.microsoft.com, teams.cloud.microsoft, teams.live.com), nielen na Google Meet. Zachytávanie
  zvuku tabu, prepis, cue okno aj Answer Now fungujú rovnako; stačí kliknúť na ikonu Ignition na
  tabe s meetingom. Desktopová aplikácia Teams sa zachytiť nedá, meeting otvor v Chrome.

- **Answer Now funguje aj so starým ID otázky:** ak panel pošle ID otázky, ktorú backend
  medzitým nahradil alebo zahodil, požiadavka sa už ticho neignoruje, ale odpovie sa na
  poslednú otázku. Otázka sa navyše zverejní (`question.updated`) ešte pred
  `recommendation.started`, takže rozšírenie výsledok nezahodí ani pri otázke, ktorú
  Answer Now práve vytvorilo z posledného prepisu.
- **Chyba počas špekulatívneho pokusu nezabije otázku:** keď zlyhá automatický pokus nad
  ešte nedokončenou otázkou (typicky 429 rate limit počas reči), otázka sa neuzavrie ako
  „Could not finish“ a finálny prepis toho istého segmentu sa normálne zodpovie. Zlyhanie
  sa iba zaloguje (`generation.failed`) a prípadný backoff sa dodrží. Zlyhanie manuálneho
  pokusu alebo pokusu nad hotovou otázkou sa hlási ako doteraz.
- **Opakovanie po `Retry-After` sa nestratí:** časovač opakovania má vlastné pole, takže ho
  ďalší prepis alebo zmena reči (ktoré doteraz časovač zrušili) už neprerušia.
- **Vlastná reč otázku nezahodí:** mikrofón zachytávajúci tvoju reč (aj krátke „mhm“) iba
  zablokuje automatické odpovede; rozpracovaná otázka ostáva, jej pokračovanie sa k nej
  pripojí a Answer Now na ňu funguje. Po uplynutí 1 s ochranného intervalu sa automatika
  prehodnotí: otázka, ktorej finálny prepis prišiel počas intervalu, sa zodpovie sama.
  Otázka, ktorá celá prišla počas tvojej reči, ostáva ako doteraz iba pre Answer Now.
- **Nedokončená otázka sa po ticho zodpovie sama:** keď model označí finálnu otázku ako
  neúplnú (`questionComplete=false`), backend už nečaká donekonečna na pokračovanie. Ak do
  2 s ticha nič nepríde, spraví ešte jeden pokus a odpoveď zverejní s poznámkou „Incomplete
  question — confirm the meaning“. Chyba `QUESTION_INCOMPLETE` po 30 s ostáva len pre prípad,
  že rečník ďalej hovorí bez prepisu.
- **Answer Now uprostred otázky neoreže otázku:** keď stlačíš Answer Now, kým segment ešte nie
  je finálny, jeho finálny prepis sa k otázke pripojí (panel ukáže celý text) a ak pribudli
  slová, celá otázka sa zodpovie automaticky. Finálny prepis, ktorý doplní iba interpunkciu,
  druhú odpoveď nespustí. Rovnako sa doplní otázka uzavretá chybou prepisu
  (`TRANSCRIPTION_STALLED`), ak jej finálny prepis predsa dorazí.
- **Answer Now nezruší nová otázka iného rečníka:** manuálny pokus dobehne aj vtedy, keď
  medzitým príde iná (alebo dlhšia) otázka; výsledok sa doručí s textom otázky, na ktorú si
  sa pýtal, a rozšírenie ho zobrazí, hoci panel už ukazuje novú otázku. Nová otázka sa potom
  zodpovie automaticky ako doteraz.
- **Lacnejšia špekulácia počas reči:** priebežné odpovede nad ešte hovorenou otázkou sa
  spúšťajú najviac raz za 2 s (predtým 1 s) a len keď čiastočný text už vyzerá ako celá otázka
  („…what is the budget for“ sa preskočí). Menej volaní OpenAI, menšie riziko 429.
- **README:** v riešení problémov pribudol riadok k falošnej chybe `npm test` pod Node 20
  (`nvm use`).
- **Preklep v ID faktu už nezahodí hotovú odpoveď:** keď model v návrhu uviedol ID faktu alebo
  segmentu, ktoré backend nepoznal (napr. o znak kratšie), návrh sa potichu nahradil fallbackom
  „I don't have enough verified information…“ bez opravy, bez kontroly podloženosti a bez
  záznamu. Teraz sa ID s jednoznačným preklepom opraví (vrátane vynechanej predpony `personal-`, ktorú
  model často vypúšťa), neznáme ID a metadáta pre osobné či necitované fakty sa vypustia, neznáme ID segmentov sa nahradia aktuálnymi a návrh ide
  normálne do kontroly podloženosti. Zmena sa zaznamená ako `grounding.sanitized`.
- **Šablóna „My specific responsibilities are not documented…“ je zrušená:** ochrana pred
  vymyslenou osobnou históriou (`protectPersonalDraft`) ňou nahrádzala celé odpovede (stanovisko
  k alokácii úloh, predstavenie projektu a všeobecné otázky), len čo model medzi chýbajúce informácie
  uviedol zodpovednosti alebo úlohy. Zmienky o roli teraz posudzuje lokálne pravidlo pre
  zodpovednosti (vedie k oprave) a kontrola podloženosti veta po vete. Zostávajúce zástupné
  texty pre chýbajúcu motiváciu a skúsenosti sa vkladajú len pri návrhoch v prvej osobe.
- **Chybný výsledok kontroly podloženosti nezabije opravený návrh:** reviewer-model občas vráti
  nekonzistentný výsledok (vynechaná veta, „podložené“ bez dôkazu). Doteraz mala celá otázka
  jediný opakovaný pokus, takže druhá chyba pri kontrole opraveného návrhu skončila chybou
  `EVIDENCE_REVIEW_INVALID` („Could not finish“). Teraz má každá kontrola vlastný opakovaný pokus.
- **Zdvorilý fallback namiesto „I don't have enough verified information…“:** keď sa nepodarí
  overiť žiadnu podloženú odpoveď, cue ponúkne prosbu o zopakovanie alebo upresnenie otázky
  („Could you repeat the question? I want to make sure I address exactly what you are asking.“
  a ďalšie tri varianty, striedané podľa témy). Pri technickej otázke (architektúra, model,
  algoritmus, API, latencia, presnosť, dataset, integrácia, bezpečnosť…) cue namiesto toho
  navrhne odložiť odpoveď na vývojový tím („I would rather check it with our development team and
  come back to you with a precise answer.“); názvy ako „University of Technology“ sa za technický
  obsah nepočítajú. Odporúčanie pod vetou vysvetľuje, že ide o získanie času bez hádania a
  detaily treba potvrdiť po hovore.
- **Vlastná reč už neblokuje automatické odpovede:** hovorenie do mikrofónu (aj prisvedčenie alebo
  zvuk z reproduktorov bez slúchadiel) už nezruší rozpracovanú automatickú odpoveď, nezahodí
  pripravený návrh ani neodloží jej zobrazenie; jednosekundový ochranný interval je zrušený. Stav
  „You are speaking“ ostáva len informačný. Automatiku vypína iba nedostupný mikrofón, Answer Now
  funguje vždy. Pri improvizácii tak cue príde ako záchranná sieť.
- **Cue okno ako história:** pod najnovšou odpoveďou sa zobrazujú až dve staršie (najnovšia prvá,
  stlmené, s otázkou v jednom riadku a vlastným Copy). Dismiss skryje iba najnovšiu, staršie
  ostávajú; okno dostáva celý zoznam (max. 3), nie len jednu odpoveď.
- **Kontrola podloženosti už nezahadzuje správne odpovede:** z 31 odpovedí v živých testoch 19.–20. 10.
  bolo 7 fallbackov, z toho 6 falošných. Reviewer žiadal informácie, ktoré v kontexte nie sú
  (preferencia druhej strany, jej budúce schválenie), a lokálne pravidlá zasahovali na slová
  o druhej strane. Teraz: odpoveď, ktorej všetky vety sú podložené a jedinou výhradou je takáto
  medzera, prejde a medzera sa ukáže v paneli ako „To confirm“ (reviewer v4.4); pravidlo
  o osobných zodpovednostiach platí len pre vety v prvej osobe („I coordinate…“, „my role is
  to lead…“), nie pre „which parts you've managed“ alebo „we support the partners“; slová
  „already“ a „ensure“ v bežnej reči už nie sú prehnané tvrdenia.
- **Podložená časť odpovede ostáva:** keď reviewer zamietne aj opravený návrh, v cue ostanú vety,
  ktoré označil za podložené (aspoň jedna faktická), zvyšok ide do „To confirm“. Fallback príde
  len vtedy, keď nie je podložené nič.
- **Answer Now na vetu bez otázky:** model odpovedal správnym poďakovaním, ale označil typ „none“
  a backend to zahodil ako chybu `INVALID_OUTPUT`. Teraz sa poďakovanie zachová; a ak sa odpoveď
  nepodarí overiť, fallback pri texte bez otázky je krátke potvrdenie, nie prosba o zopakovanie.

## 0.3.4 — 19. 10. 2026

- **Odpoveď sa nezasekne pri otázke, ktorá len vyzerá nedokončená:** otázky končiace slovom
  ako „is“, „for“ či „about“ („…what your company's role is?“) čakali na pokračovanie
  donekonečna, aj keď bola odpoveď hotová a skontrolovaná. Po 2 s ticha sa už berú ako
  hotové; či je otázka naozaj úplná, posúdi model.

## 0.3.3 — 19. 10. 2026

Opravy z live testu 0.3.2. Protokol 4 zostáva; reštartuj backend a znova načítaj rozšírenie.

- **Tvoja reč už nezruší zobrazený náhľad:** keď začneš hovoriť (čítať návrh nahlas), rozpracovaná
  odpoveď, ktorej náhľad už vidíš, sa dokončí a zobrazí. Tvoja reč stále blokuje spúšťanie
  nových automatických odpovedí. Predtým sa náhľad zrušil a cue skočilo na predošlú odpoveď.
- **Otázka sa nerozdelí pri krátkej pauze:** ak rečník po zdanlivo hotovej otázke do 1,5 s
  pokračuje („…or multimodal verification approaches“) a otázka ešte nie je zodpovedaná,
  pokračovanie sa pripojí k otázke namiesto toho, aby sa odpovedalo iba na jej koniec.

## 0.3.2 — 19. 10. 2026

Cue a náhľad počas meetingu. Protokol 4 zostáva; reštartuj backend a znova načítaj rozšírenie.

- **Cue nezmizne po prvej odpovedi:** posledná odpoveď zostane v cue okne aj po skončení
  otázky, kým ju nenahradí novšia odpoveď alebo jej náhľad, alebo kým ju nezavrhneš. Predtým
  ju skryl aj krátky ďalší prepis („Okay.“).
- **Náhľad nezmizne pred hotovou odpoveďou:** ak sa zobrazil „Checking facts…“ a rečník
  medzitým znova prehovoril, skontrolovaná odpoveď sa predtým zahodila. Teraz sa zverejní.
  Zahodený skrytý návrh backend oznámi, aby po ňom na obrazovke nič nezostalo.
- **Diagnostika:** `IGNITION_DEBUG=1` vypíše tok udalostí backendu (iba ID a stavy, bez
  textu); offscreen konzola rozšírenia loguje riadky `[ignition]` s tým, čo cue ukazuje.

## 0.3.1 — 19. 10. 2026

Opravy spoľahlivosti počas meetingu. Protokol 4 zostáva; stačí reštartovať backend a znova
načítať rozšírenie.

- **Prepis nepadá kvôli jednému úseku:** zlyhaný úsek prepisu sa uzavrie s doteraz prijatým
  textom a odmietnutý úsek zvuku sa preskočí. Relácia sa už kvôli tomu neprepája a nemaže prepis.
- **Pomalšia sieť:** pri preťaženom spojení sa zahodí kúsok zvuku namiesto ukončenia relácie.
  Mŕtve spojenie stále zachytí kontrola spojenia.
- **Bez falošných chýb bez mikrofónu:** hlásenie „The question did not finish“ sa zobrazí
  iba pri zapnutých automatických odpovediach. Bežná reč bez otázky sa uzavrie a nezlepí
  sa s ďalšou otázkou.
- **Answer Now sa nezablokuje** po jednej chybe 400/404 od OpenAI (zlý kľúč alebo kredit
  ho blokujú naďalej).
- **Dlhší limit na odpoveď:** 25 s namiesto 15 s (generovanie, kontrola faktov aj Check).
- Backend zapíše neočakávanú internú chybu do terminálu a beží ďalej.

## 0.3.0 — 12. 10. 2026

- **Verzia v rohu:** panel, nastavenia aj cue okno ukazujú `v0.3.0 · dátum zostavenia`.
  Ak backend beží na inej verzii, štítok zoranžovie a ukáže aj verziu servera.
- **Rýchlejší prvý návrh:** prvá odpoveď sa zobrazí hneď po vygenerovaní, označená
  „Checking facts… / Unverified draft“, a po kontrole podloženosti ju nahradí overená odpoveď.
  Dá sa vypnúť v _Project & connection → Show first draft while facts are checked_.
- Protokol 4 — po aktualizácii reštartuj backend aj rozšírenie.
- Dlhý soak test toleruje prirodzené pauzy v reči (postup zvuku sa kontroluje v 30 s okne).
- Projekt je v gite; pôvodný stav je tag `v0.2.0`.

## 0.2.0 — 11.–12. 10. 2026

- Report 2 opravy spoľahlivosti, kontrola podloženosti QUICK odpovedí, cue okno, nastavenia odpovedí.
