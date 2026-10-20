# Handoff: noclue by ignition – brand & design manual

## Overview
Brand identity for **noclue**, an app in the Ignition product family. Covers the logo lockup, app icon / favicon (question-mark glyph, replaces the Ignition rocket for this product), colors, typography, usage rules and tone of voice. Use it to set up the app's design tokens, icon assets and logo component.

## About the Design Files
Files in this bundle are **design references created in HTML** – they show the intended look, not production code to copy. Recreate them in the target codebase's environment (React, Vue, SwiftUI, native…) using its patterns. If no environment exists yet, pick the most appropriate framework. The SVGs in `assets/` and `tokens.css` are production-ready and can be used directly.

## Fidelity
**High-fidelity.** Colors, type, geometry and sizes are final.

## Logo

### Lockup (horizontal)
- Row, `align-items: center`, gap **22px** (at 96px icon).
- **Icon tile** 96×96, radius 24px (25 % of side), background `linear-gradient(145deg, #FF7A3C, #F35216)`; glyph 60×60 centered, white.
- **Wordmark** column, gap 4px, line-height 1:
  - `noclue` – Anta 52px, letter-spacing −0.02em, color #1A1614 (light bg) / #F5F4F0 (dark bg).
  - `by ignition` – Anta 20px, letter-spacing 0.02em; "by" #7A726D (dark bg: #B8B1AB), "ignition" #F35216 (dark bg: #FF7A3C).
- Scale everything proportionally from the 96px icon.
- **Clear space:** ≥ ¼ of icon height on all sides.
- **Min size:** full lockup 120px wide (digital) / 30mm (print). Below that use the icon only.
- "by ignition" may be omitted only inside the app (nav bar, splash).
- Allowed backgrounds: #171717 or #F5F4F0 / white. Never on orange or busy photos.

### Glyph (question mark)
SVG, viewBox 0 0 100 100:
```svg
<path d="M30 34 A20 20 0 1 1 58 52 Q50 57 50 66 L50 70" fill="none" stroke="#fff" stroke-width="13" stroke-linecap="round"/>
<circle cx="50" cy="88" r="7.5" fill="#fff"/>
```
- Occupies ~62 % of the tile, optically centered.
- Small-size stroke compensation: 64px → stroke 14 / dot r 8; 32px → 15 / 8.5; 16px → 16 / 9.

### Icon variants
| Variant | Tile | Glyph |
|---|---|---|
| Primary | gradient #FF7A3C → #F35216 | #FFFFFF |
| Dark | #171717 | #F35216 |

Sizes to export: 512, 180 (apple-touch-icon), 64, 32, 16. Tile radius always 25 % of side (iOS/Android apply their own mask – supply a square, full-bleed tile for app stores).

## Design Tokens
See `tokens.css`.

**Colors**
- Orange gradient `#FF7A3C → #F35216` (145deg) – icon tile only
- Accent `#F35216` – primary buttons, links, highlights; one main action per screen
- Ink / anthracite `#171717` – dark background, headings
- Text `#1A1614`, secondary text `#4A4440`
- Warm grey `#7A726D` – logo subtitle, captions
- Paper `#F5F4F0` – light background, text on dark
- Surface `#FFFFFF`, divider `#DEDAD4`
- Orange is the only accent color. No other hues.

**Typography**
- **Anta** (Google Fonts) – logo and short display headlines only (splash, empty states). Never body text.
- **Manrope** (Google Fonts, 400–800) – all UI.

| Style | Size | Weight | Line-height | Letter-spacing |
|---|---|---|---|---|
| H1 | 40px | 800 | 1.1 | −0.03em |
| H2 | 28px | 800 | 1.15 | −0.02em |
| Body | 17px | 500 | 1.5 | 0 |
| Caption | 14px | 600 | 1.4 | 0 |
| Buttons / labels | – | 600–700 | – | – |

**Radius:** icon tile 25 %, cards 20px, swatches 16px.
**Effects:** none – no shadows, glows, outlines, 3D.

## Usage rules
Do:
- Logo on anthracite or off-white
- Icon alone as favicon, app icon, avatar
- Respect clear space and min size

Don't:
- Recolor, add shadows / outlines / 3D / glow
- Distort, rotate, change icon-to-wordmark ratio
- Place on busy photos or orange backgrounds
- Replace the question mark with the Ignition rocket

## Tone of voice
Friendly and calm. Not knowing is normal – noclue never shames the user, it helps briefly and factually to the next step. Short sentences, no jargon, no exclamation marks, no overpromising. Primary language Slovak (correct diacritics).

## Interactions / State
Not applicable – brand manual only. App screens are not designed yet.

## Assets
- `assets/noclue-icon.svg` – primary icon tile 512×512
- `assets/noclue-icon-dark.svg` – dark icon tile 512×512
- `assets/favicon.svg` – 32×32 favicon with small-size stroke
- `assets/noclue-glyph.svg` – bare glyph, `currentColor`
- Fonts: Anta, Manrope from Google Fonts

## Files
- `noclue Design Manual.dc.html` – full design manual (open in browser; needs `support.js` alongside)
- `Ignition Logo.dc.html` – all Ignition-family logos incl. noclue lockup (`#lg-noclue`) and icon tiles (`#lg-noclue-icon`, `#lg-noclue-dark`)
