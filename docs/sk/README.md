# noclue by ignition (slovensky)

noclue je rozšírenie pre Chrome. Počas hovoru v Google Meet alebo Microsoft Teams (vo webe)
počúva ostatných účastníkov, rozpozná otázku a navrhne krátku odpoveď, ktorú poviete vlastnými
slovami. Odpovede vychádzajú z faktov o projekte, ktoré si zadáte, a každá faktická veta sa
pred zobrazením overí.

noclue nemá server ani účet. Používate vlastný kľúč OpenAI (a voliteľne Anthropic), takže
poskytovateľovi AI platíte priamo a len za to, čo použijete.

## Inštalácia

1. Nainštalujte **noclue by ignition** z Chrome Web Store. Kým zápis v obchode nie je
   schválený: stiahnite `noclue-<verzia>.zip` z GitHub Releases, rozbaľte ho, otvorte
   `chrome://extensions`, zapnite Režim pre vývojárov a zvoľte **Načítať rozbalené**.
2. Otvorí sa sprievodca: vložte kľúč OpenAI, otestujte mikrofón a prečítajte si, kam idú dáta.
3. Otvorte meeting v Chrome, kliknite na ikonu noclue v lište, doplňte pár faktov a zvoľte
   **Start Listening**.

Kľúč OpenAI: https://platform.openai.com/api-keys. Kľúč Anthropic (voliteľný):
https://console.anthropic.com/settings/keys. Pre noclue si vytvorte samostatný kľúč s mesačným
limitom.

## Súkromie v skratke

- Zvuk z vybranej karty ide do OpenAI na prepis, len kým počúvate. Neukladá sa.
- Fakty o projekte, profil a nedávny prepis idú do OpenAI alebo Anthropic na prípravu odpovede.
- Mikrofón zostáva vo vašom počítači, slúži len na rozpoznanie, že hovoríte.
- Kľúče a nastavenia sú len v tomto profile Chrome. Žiadna analytika.
- Prepis iných ľudí môže vyžadovať ich súhlas. Informujte účastníkov, ak to pravidlá alebo
  situácia vyžadujú.

Používateľské rozhranie je v angličtine, lebo noclue pomáha pri anglických meetingoch. Názov a
popis rozšírenia sú preložené. Podrobnosti v [README](../../README.md) a [PRIVACY](../../PRIVACY.md).
