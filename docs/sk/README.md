# noclue by ignition (slovensky)

noclue je rozšírenie pre Chrome. Počas hovoru v Google Meet alebo Microsoft Teams (vo webe)
počúva ostatných účastníkov, rozpozná otázku a navrhne krátku odpoveď, ktorú poviete vlastnými
slovami. Odpovede využívajú vaše fakty a predvolene sa zobrazia až po AI kontrole. Skorší
neoverený náhľad si môžete zapnúť. Aj skontrolovaná odpoveď môže obsahovať chyby. Režim
**Stick to my knowledge** vypne používanie všeobecných znalostí.

noclue nemá server ani účet. Používate vlastný kľúč OpenAI (a voliteľne Anthropic), takže
poskytovateľovi AI platíte priamo a len za to, čo použijete.

## Inštalácia

1. Stiahnite `noclue-<verzia>.zip` z [GitHub Releases](https://github.com/ladislavmathis/noclue/releases/latest),
   rozbaľte ho, otvorte `chrome://extensions`, zapnite Režim pre vývojárov a zvoľte
   **Načítať rozbalené**. Odkaz na Chrome Web Store doplníme po sprístupnení zápisu.
2. Otvorí sa sprievodca: vložte kľúč OpenAI, otestujte mikrofón a prečítajte si, kam idú dáta.
3. Otvorte meeting v Chrome, kliknite na ikonu noclue v lište, doplňte pár faktov a zvoľte
   **Start Listening**.

Po inštalácii alebo aktualizácii obnovte už otvorené meetingové karty.

Kľúč OpenAI: https://platform.openai.com/api-keys. Kľúč Anthropic (voliteľný):
https://console.anthropic.com/settings/keys. Pre noclue si vytvorte samostatný kľúč s mesačným
limitom.

## Súkromie v skratke

- Zvuk z vybranej karty ide do OpenAI na prepis, len kým počúvate. Neukladá sa.
- Fakty o projekte, profil a nedávny prepis idú do OpenAI alebo Anthropic na prípravu odpovede.
- Mikrofón zostáva vo vašom počítači, slúži len na rozpoznanie, že hovoríte.
- Kľúče a nastavenia sa ukladajú v tomto profile Chrome. Kľúče sa posielajú iba príslušnému AI poskytovateľovi. Žiadna analytika.
- Stop vymaže aj testový záznam; ak ho chcete zachovať, exportujte ho pred zastavením.
- Obsah cue okna môže čítať meetingová stránka. Na citlivé údaje použite bočný panel.
  Detekcia zdieľania obrazovky nie je záruka; overte, čo vidia ostatní účastníci.
- Prepis iných ľudí môže vyžadovať ich súhlas. Informujte účastníkov, ak to pravidlá alebo
  situácia vyžadujú.

noclue funguje na meetingoch v angličtine, slovenčine, češtine a nemčine. V nastaveniach zvoľte
jazyk meetingu, alebo Automaticky, a odpoveď príde v jazyku otázky. Rozhranie a tipy sú v
angličtine, názov a popis rozšírenia sú preložené. Podrobnosti v [README](../../README.md) a [PRIVACY](../../PRIVACY.md).

noclue vyvíja [ignition.sk](https://ignition.sk).
