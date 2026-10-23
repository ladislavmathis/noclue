# Releasing noclue

Everything here is free except the one-time Chrome Web Store developer fee (5 USD).

## Before every release

1. Update the version in `package.json`, `packages/shared/src/index.ts` (`APP_VERSION`) and
   `apps/extension/public/manifest.json`, and add a `CHANGELOG.md` entry.
2. `npm run typecheck && npm test && npm run test:browser && npm run secrets:check`
3. One real meeting check with your own keys: Setup guide, Check, a Google Meet call with a
   second participant asking English questions, Answer Now, cue window, Stop. Repeat once with
   Anthropic selected, and once with the meeting language set to Slovak and Slovak questions.
4. `npm run package` creates `release/noclue-<version>.zip`.
5. When dependencies changed, check that `NOTICES.md` and `apps/extension/dist/NOTICES.txt` still
   cover every package in the bundle (`grep -l <package> apps/extension/dist/assets/*.js`).

## One-time setup

### 1. GitHub Pages (privacy policy and landing page)

In the repository: Settings, Pages, Source "GitHub Actions". The `pages` workflow
publishes `docs/site`. The privacy policy URL is then
`https://ladislavmathis.github.io/noclue/privacy.html`.

### 2. Chrome Web Store

1. Register at https://chrome.google.com/webstore/devconsole (5 USD, one time) and verify a
   contact e-mail.
2. New item: upload `release/noclue-<version>.zip`.
3. Store listing: copy the texts from `store/LISTING.md`; upload `store/icon-128.png`,
   `store/promo-small-440x280.png`, `store/promo-marquee-1400x560.png` and five 1280×800
   screenshots of the panel, cue window, setup guide, practice answer and settings.
4. Privacy tab: single purpose, permission justifications and data disclosures from
   `store/LISTING.md`. Privacy policy URL from step 1.
5. Submit. Review usually takes a few days and can take longer for `tabCapture`. Answer reviewer
   questions with the "Notes for the reviewer" text.

### 3. GitHub release

Tag `v<version>` and push the tag. The `release` workflow builds, tests and attaches the zip to
a GitHub Release. Optional automatic store upload: add the secrets `CWS_EXTENSION_ID`,
`CWS_CLIENT_ID`, `CWS_CLIENT_SECRET` and `CWS_REFRESH_TOKEN`
(https://developer.chrome.com/docs/webstore/using-api).
