# Releasing noclue

GitHub builds and mocked tests do not call paid AI services. Live meeting checks use your own
provider account and incur its normal API charges. Chrome Web Store registration has a separate fee.

## Before every release

1. Update the version in `package.json`, `packages/shared/src/index.ts` (`APP_VERSION`) and
   `apps/extension/public/manifest.json`, and add a `CHANGELOG.md` entry.
2. `npm ci`, then `npx playwright install chromium` (on Linux CI, use `--with-deps`). Run
   `npm run format:check && npm run typecheck && npm test && npm run test:browser && npm run secrets:check`.
3. One real meeting check with your own keys: Setup guide, Check, a Google Meet call with a
   second participant asking English questions, Answer Now, cue window, Stop. Repeat once with
   Anthropic selected, and once with the meeting language set to Slovak and Slovak questions.
   Reload meeting tabs after updating. Check starting a screen share before opening the cue,
   closing/reopening the cue during a share, and stopping the share. Confirm Stop clears test
   recordings; export before Stop if you need to retain test data.
4. `npm run package` creates `release/noclue-<version>.zip`.

## Public repository

The public source repository is https://github.com/ladislavmathis/noclue. Work directly from
this checkout; no private export script or new Git history is needed.

Use synthetic projects and transcripts in tests, issues, screenshots and release material.
Review changes for private data; the secret scan is not a complete history/privacy audit.
Enable private vulnerability reporting in GitHub Settings so the route in SECURITY.md works.

## GitHub Pages (privacy policy and landing page)

In the public repository: Settings, Pages, Source "GitHub Actions". The `pages` workflow
publishes `docs/site`. The privacy policy URL is then
`https://ladislavmathis.github.io/noclue/privacy.html`. Verify it before store submission.
Regenerate the checked-in privacy page after editing PRIVACY.md with
`python3 -I scripts/build-privacy-page.py`. The generated page is excluded from Prettier.

## Chrome Web Store

1. Register at https://chrome.google.com/webstore/devconsole (5 USD, one time) and verify a
   contact e-mail.
2. New item: upload `release/noclue-<version>.zip`.
3. Store listing: copy the texts from `store/LISTING.md`; upload `store/icon-128.png`,
   `store/promo-small-440x280.png`, `store/promo-marquee-1400x560.png` and five 1280×800
   screenshots of the panel, cue window, setup guide, practice answer and settings.
4. Privacy tab: single purpose, permission justifications and data disclosures from
   `store/LISTING.md`. Privacy policy URL from step 2.
5. Submit. Review usually takes a few days and can take longer for `tabCapture`. Answer reviewer
   questions with the "Notes for the reviewer" text.
6. Once the listing is approved, add its real URL to README.md, docs/sk/README.md and the landing
   page. Until then, keep the GitHub beta download and Load unpacked instructions.

## GitHub release

After the manual checks above, tag `v<version>` and push the tag. The `release` workflow checks
formatting, types, secrets, unit tests and the full mocked browser suite on that exact tag
before attaching the production ZIP to a GitHub Release. It cannot validate real meetings
or live provider access. Optional automatic store upload: add the secrets `CWS_EXTENSION_ID`,
`CWS_CLIENT_ID`, `CWS_CLIENT_SECRET` and `CWS_REFRESH_TOKEN`
(https://developer.chrome.com/docs/webstore/using-api).
