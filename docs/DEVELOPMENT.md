# Developing noclue

## Requirements

- Node.js 22 or newer (`nvm use` reads `.nvmrc`).
- Current desktop Chrome or Chromium.
- For browser tests once: `npx playwright install chromium`.

## Layout

| Path                            | What it is                                                                                                                                                                |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/extension`                | The Chrome extension (Manifest V3, React, Vite).                                                                                                                          |
| `apps/extension/src/offscreen`  | Long-lived offscreen document: tab capture, local VAD, PCM, meeting session.                                                                                              |
| `apps/extension/src/sidepanel`  | Side panel UI.                                                                                                                                                            |
| `apps/extension/src/setup`      | Setup guide (keys, microphone, data notice) and microphone test.                                                                                                          |
| `apps/extension/src/background` | Service worker and the injected cue window (`overlay.ts`).                                                                                                                |
| `apps/extension/src/connection` | `LocalSocket` and transport selection, connection check, practice preview.                                                                                                |
| `packages/core`                 | The meeting logic that used to be the local server: hub, session, question engine, transcriber, answer generation, evidence review, key test. Browser-neutral TypeScript. |
| `packages/shared`               | Schemas, protocol types, settings, limits.                                                                                                                                |
| `scripts`                       | Icon rendering, packaging, secret scan, quality evaluation.                                                                                                               |
| `docs/brand`                    | Design manual handoff, tokens and logo renders.                                                                                                                           |
| `store`                         | Chrome Web Store artwork and listing text.                                                                                                                                |

## How a meeting works

1. The toolbar click grants `activeTab`; the service worker gets a tab stream ID and starts the
   offscreen document.
2. The offscreen page captures the tab, keeps meeting audio audible, runs Silero VAD locally on
   the tab and on the microphone, and turns meeting speech into 24 kHz PCM16 frames.
3. Frames go to the hub (`packages/core/src/hub.ts`) through `LocalSocket`, an in-page stand-in
   for the WebSocket the old local server used. The protocol (`packages/shared`) is unchanged.
4. The hub streams PCM to OpenAI realtime transcription. Browsers cannot set an `Authorization`
   header on a WebSocket, so the user's key is sent as the `openai-insecure-api-key.<key>`
   subprotocol over TLS, which OpenAI supports for browser clients.
5. Questions are detected locally (`questions/engine.ts`). Answers are generated and then
   checked sentence by sentence against the user's facts (`recommendations/provider.ts`,
   `grounding.ts`) through a `StructuredModel` (`recommendations/llm.ts`), which has an OpenAI
   (Responses API) and an Anthropic (Messages API) implementation.

All provider calls run in the browser with the user's own key (`dangerouslyAllowBrowser` in both
SDKs). That is deliberate for a bring-your-own-key extension: there is no server that could
hold a shared key.

## Commands

```bash
npm run build          # production extension in apps/extension/dist
npm run dev            # rebuild on change; reload the extension in chrome://extensions
npm run typecheck
npm test               # unit tests (Vitest)
npm run test:browser   # builds the test extension, then Playwright
npm run test:soak      # 30-minute synthetic capture session
npm run icons          # re-render icons and store artwork from the brand geometry
npm run secrets:check  # fails if a real-looking API key is in the tree
npm run package        # production build zipped to release/noclue-<version>.zip
npm run eval:quality   # billed: live answer quality run, needs OPENAI_API_KEY in .env
```

### Browser tests and the test build

`npm run build:test` builds `apps/extension/dist-test`. It is the same extension, except that
the hub runs in the test process (`tests/helpers/hub-server.ts`) and is reached over
`ws://127.0.0.1`. Tests inject fake transcription and answer providers there, so real tab
capture, VAD and PCM are exercised without any API account or cost. The production build has
no localhost permission; `npm run package` refuses to zip a test build.

## Versioning

`package.json` is the single source of the version. `APP_VERSION` in `packages/shared` and
`apps/extension/public/manifest.json` must match (`tests/version.test.ts`). Add a `CHANGELOG.md`
entry for each release. Bump `PROTOCOL_VERSION` when the hub message protocol changes.

## Release

See [RELEASE.md](RELEASE.md).
