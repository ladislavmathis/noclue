# Changelog

All notable changes to noclue are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/): PATCH for fixes, MINOR for features, MAJOR for
incompatible changes. Every release gets an entry here and a git tag `vX.Y.Z`.

`package.json` is the single source of the version. `APP_VERSION` in `packages/shared` and
`apps/extension/public/manifest.json` must match it (`tests/version.test.ts`). A Slovak version
of this file is in [docs/sk/CHANGELOG.md](docs/sk/CHANGELOG.md).

## [Unreleased]

### Changed

- The share observer starts when a Meet or Teams page loads and replays the share state when
  the cue is opened or reopened. Tabs opened before the update must be reloaded; without the
  observer the cue does not show. Detection is best effort and does not cover shares started
  from other applications.
- Unverified previews are off by default. An explicit user choice is kept; the guide and the
  public texts explain the limits of the AI check.
- Stop also clears the in-memory test recording. Export before stopping; files already
  downloaded stay with the user.
- The website links to the GitHub beta download with instructions. The release documentation
  matches the public repository and the release workflow requires the browser tests before
  publishing.
- The diagnostics console no longer stores free text from the AI check. The secret scan also
  catches further token types, nested `.env` files and keys placed after test values.
- Repository cleanup for the public release: English changelog, full code of conduct,
  pinned GitHub Actions, Dependabot, ESLint, complete third-party notices. The public material
  contains only noclue; the unrelated brand catalogue and pre-release internal notes are gone.
- The cue window only accepts its own commands from the meeting page; the full transcript is
  never sent into the meeting tab.
- Vitest updated to 4.1.12 for vulnerability fixes in development dependencies.

### Fixed

- The cue stayed visible on a whole-screen share after Pop out or Back.
- Opening the cue while the offscreen document was starting could show a raw error.

## [0.5.0] - 2026-10-20

### Added

- **Meeting language:** English, Slovak, Czech, German or Automatic, set under Response
  preferences. The transcriber receives it as the expected input language, answers are written
  in it, and coaching and the interface stay in English. Automatic answers in the language of
  the question.
- **Question detection** knows Slovak, Czech and German question cues.
- **Spoken fallback phrases** (ask to repeat, defer a technical question, thank, clarify) are
  translated into all supported languages. The evidence review judges meaning across languages.
- **Cue window off screen shares:** a Pop out button moves the cue into a Document
  Picture-in-Picture window, which tab and window shares do not capture. A read-only observer
  in the meeting page notices shares started there: the in-page cue hides during any share, the
  floating window only during a whole-screen share, and both return when sharing stops.

### Changed

- English-only wording checks run only on English answers.
- Prompts `quick-b2-v05.0-languages` and `evidence-review-v4.5-languages`.

## [0.4.0] - 2026-10-20

First public release under the name **noclue by ignition**.

### Added

- **Bring your own key:** the OpenAI key (and optionally an Anthropic key) is entered in the
  extension and stored only in `chrome.storage.local`. Transcription goes directly to the OpenAI
  realtime API (key as the WebSocket subprotocol), answers directly to OpenAI or Anthropic.
  Testing a key is free: it only reads model details.
- **Anthropic as answer and fact-check provider:** Claude Opus 5.5, Sonnet 5.5 or Haiku 5.5
  with structured output and low effort for latency. Transcription stays on OpenAI.
- **Setup guide:** keys, microphone test and a data-flow explanation with consent. Start is
  available only after the guide is finished.
- **New brand:** logo, colours, the Anta and Manrope fonts (bundled locally) and the noclue
  tone. Light and dark panel themes, dark cue window.

### Changed

- **No server:** all logic (transcription, questions, answers, fact check) runs inside the
  extension. No Node.js, terminal or `.env` is needed. Protocol 5.
- **Tests:** browser tests run against a test build (`npm run build:test`) that connects to a
  local test hub with fake AI providers. The production build has no localhost permission.

## [0.3.5] - 2026-10-19

### Added

- Microsoft Teams on the web (teams.microsoft.com, teams.cloud.microsoft, teams.live.com) in
  addition to Google Meet. The Teams desktop app cannot be captured.
- The cue window keeps up to two earlier answers under the newest one.
- Polite fallbacks when no grounded answer can be verified: ask to repeat or clarify, or defer a
  technical question to the team.

### Fixed

- Answer Now works with a stale question ID, in the middle of a question, and is not cancelled
  by a newer question from another speaker.
- A failed speculative attempt (for example a rate limit while someone is still speaking) no
  longer closes the question.
- Retry timers survive new transcript segments.
- Your own speech no longer discards an in-progress question or a verified draft.
- Incomplete questions are answered after two seconds of silence instead of waiting forever.
- Typos in fact IDs returned by the model are corrected instead of replacing the answer with a
  fallback.
- The evidence review no longer rejects answers whose only issue is a gap in the context; the
  gap is shown as "To confirm". Grounded sentences stay when a repaired draft is rejected.
- A thank-you with no question is kept instead of failing with `INVALID_OUTPUT`.

## [0.3.4] - 2026-10-19

### Fixed

- Questions that only look unfinished ("…what your company's role is?") are treated as complete
  after two seconds of silence.

## [0.3.3] - 2026-10-19

### Fixed

- Starting to speak no longer cancels a preview that is already visible.
- A short pause inside a question no longer splits it into two.

## [0.3.2] - 2026-10-19

### Fixed

- The cue no longer disappears after a short follow-up transcript.
- A preview is no longer discarded before the checked answer arrives.

## [0.3.1] - 2026-10-19

### Fixed

- Transcription reliability: a failed segment is closed with the text received so far; a slow
  network drops a little audio instead of ending the session.
- No false "The question did not finish" errors without a microphone.
- Answer Now is not blocked after one 400/404 error.

### Changed

- Answer timeout raised from 15 s to 25 s.

## [0.3.0] - 2026-10-12

### Added

- Version badge in the panel, settings and cue window.
- A first draft is shown while facts are checked ("Checking facts… / Unverified draft"); the
  verified answer replaces it. Can be turned off in settings.

## [0.2.0] - 2026-10-12

- Reliability fixes, evidence review of quick answers, cue window, response settings.

[Unreleased]: https://github.com/ladislavmathis/noclue/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/ladislavmathis/noclue/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/ladislavmathis/noclue/releases/tag/v0.4.0
[0.3.5]: https://github.com/ladislavmathis/noclue/releases/tag/v0.4.0
[0.3.4]: https://github.com/ladislavmathis/noclue/releases/tag/v0.4.0
[0.3.3]: https://github.com/ladislavmathis/noclue/releases/tag/v0.4.0
[0.3.2]: https://github.com/ladislavmathis/noclue/releases/tag/v0.4.0
[0.3.1]: https://github.com/ladislavmathis/noclue/releases/tag/v0.4.0
[0.3.0]: https://github.com/ladislavmathis/noclue/releases/tag/v0.4.0
[0.2.0]: https://github.com/ladislavmathis/noclue/releases/tag/v0.4.0
