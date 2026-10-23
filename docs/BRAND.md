# noclue brand in the product

The design manual from the designer is in [docs/brand](brand/) (`HANDOFF.md`, `tokens.css`,
the noclue manual HTML file and rendered lockups). These rules apply to everything in this
repository.

## Logo and icon

- Lockup: orange icon tile with the question mark, `noclue` in Anta, subtitle `by ignition`.
  Inside the extension the subtitle is left out (allowed by the manual); the setup guide, store
  artwork, README and website use the full lockup.
- Icon tile radius is 25 % of its side, the glyph ~62 %. Small sizes use the thicker strokes from
  the manual. The React component is `apps/extension/src/ui/Logo.tsx`; PNG icons and store
  artwork are rendered by `npm run icons` (`scripts/build-icons.mjs`).
- Only on anthracite `#171717` or off-white `#F5F4F0`. Never recolour, add shadows, outlines or
  glow, rotate, or replace the question mark with the Ignition rocket.

## Colour

Tokens: `apps/extension/src/styles/brand-tokens.css` (unchanged copy of the manual) and the
semantic layer in `apps/extension/src/styles/theme.css`.

- Orange `#F35216` (on dark `#FF7A3C`) is the only accent: one main action per screen (Start
  Listening, Answer Now, Save), links and the live indicator.
- The gradient `#FF7A3C → #F35216` is for the icon tile only.
- Status uses no extra hues: a finished check is an ink circle with a tick, a problem is a notice
  with an orange left edge.
- Light theme is the default for the panel and setup; dark follows the system. The cue window is
  always dark because it sits over video.
- Known trade-off: white text on `#F35216` has a contrast of about 3.5:1, which meets WCAG AA
  only for large or bold text. Primary buttons therefore use 16 px bold labels; the dark theme
  uses ink text on `#FF7A3C`.

## Type

- Manrope for all UI (bundled in `apps/extension/public/fonts`, SIL OFL). Headings 800, buttons
  and labels 600–700, text 500.
- Anta only for the wordmark and very short display lines (the empty state).

## Voice

Friendly and calm. Not knowing is normal; noclue never shames the user and helps briefly to the
next step. Short sentences, no jargon, no exclamation marks, no overpromising.
