# Chrome Web Store listing: noclue by ignition

Copy these texts into the developer console. Artwork is in this folder (`npm run icons`).

## Name

noclue by ignition

## Summary (132 characters max, from `_locales/en/messages.json`)

Short, calm answers for your Google Meet and Teams calls, based on your own facts. Uses your own OpenAI or Anthropic key.

## Category and language

Category: Productivity / Tools. Language: English (Slovak name and summary are in `_locales/sk`).

## Description

Not knowing is normal. noclue helps you find a short, honest answer when someone asks you
something in a meeting.

noclue listens to the other people in your Google Meet or Microsoft Teams tab in Chrome. When
someone asks a question, it prepares one to three short sentences you can say in your own
words, using the project facts and profile you add. By default, answers appear after an AI
evidence review. You can opt into earlier unverified drafts. AI can still make mistakes:
review the answer before using it. Turn on Stick to my knowledge to exclude general knowledge.

How it works
• Add a few facts about your project and what you want from the meeting.
• Open your meeting in Chrome, click the noclue icon and start listening.
• Answers appear in the side panel or in a small cue window over the meeting.
• Answer Now requests an answer immediately. Stop clears the temporary transcript and test recording.

Your own key, no account
noclue has no server and no account. You paste your own OpenAI API key, and optionally an
Anthropic key to use Claude for answers. You pay your provider directly, only for what you use.

Private by design
• Your microphone never leaves your computer. It only tells noclue when you are speaking.
• Meeting audio is sent to OpenAI for live transcription and is never saved.
• Keys are stored in your Chrome profile. Project facts are sent to your chosen AI provider
when preparing an answer.
• No analytics, no tracking.
• The optional in-page cue is readable by the meeting page. Use the side panel for sensitive
information. Screen-share detection is best effort; check what your audience can see.

Good to know
• Meetings in English, Slovak, Czech or German. The interface is in English.
• Chrome desktop, Google Meet and Microsoft Teams on the web.
• Headphones work best.
• Transcribing other people may need their consent where you live.

Open source under the MIT license.

## Single purpose

noclue suggests short spoken answers during the user's own online meetings, based on facts the
user provides, by transcribing the meeting tab the user selects.

## Permission justifications

| Permission                         | Why it is needed                                                                                                                                                                 |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tabCapture`                       | Captures audio of the meeting tab the user starts noclue on, so other participants can be transcribed. Only after the user clicks the toolbar icon and Start Listening.          |
| `offscreen`                        | Runs audio capture, playback passthrough and local voice detection in an offscreen document that keeps working while the side panel is closed.                                   |
| `sidePanel`                        | Shows answers, the transcript and settings next to the meeting.                                                                                                                  |
| `storage`                          | Saves the user's API keys, project facts and preferences locally on the device.                                                                                                  |
| `activeTab`                        | Grants access to the meeting tab only when the user clicks the toolbar icon there.                                                                                               |
| `scripting`                        | Injects the optional cue window into the active meeting tab when the user asks for it. Screen-share observation is handled by the document-start content script described below. |
| Host `https://api.openai.com/*`    | Sends meeting audio for transcription and, if chosen, requests answers, with the user's own key.                                                                                 |
| Host `https://api.anthropic.com/*` | Requests answers from Claude with the user's own key, only if the user chooses Anthropic.                                                                                        |

The `share-observer.js` content script runs at document start on the supported Meet and Teams
domains listed in the manifest. It observes screen-share lifecycle and surface type so a cue
opened later can hide during an already active share. It does not capture audio, read meeting
content, or send network requests. Reload existing meeting tabs after installing or updating.

Remote code: **No.** All JavaScript, the WebAssembly runtime, the voice detection model and the
fonts are bundled in the package. `wasm-unsafe-eval` is needed only to run the bundled ONNX
Runtime WebAssembly for local voice detection.

## Data usage disclosures

Collected and handled (all user-initiated, sent only to the AI provider the user configures,
never to the developer):

- **Personal communications:** meeting audio of the selected tab and its transcript.
- **Personally identifiable information:** whatever the user writes in "About me" (for example
  their name and role).
- **Authentication information:** the user's own API keys, stored locally and sent only to the
  matching provider.
- **User activity / website content:** none collected beyond the meeting tab audio above.

Certify: data is not sold, not used or transferred for purposes unrelated to the single purpose,
and not used for creditworthiness or lending.

Privacy policy URL: `https://ladislavmathis.github.io/noclue/privacy.html` (enable GitHub Pages
before submitting).

## Notes for the reviewer

noclue is a bring-your-own-key tool with no backend. To test it:

1. Install and complete the setup guide with an OpenAI API key that has access to
   `gpt-live-transcribe` and `gpt-4.1-mini` (or test the UI without a key: the guide, settings
   and validation work offline).
2. Open https://meet.google.com, start a meeting, click the noclue toolbar icon on that tab and
   choose Start Listening. Play or speak an English question in the meeting from another device.
3. The answer appears in the side panel; Show cue window displays it over the meeting.

Audio is captured only from the tab where the user clicked the toolbar icon. The microphone is
used only for local voice activity detection (Silero VAD running in WebAssembly) and is never
transmitted. The extension makes network requests only to api.openai.com and api.anthropic.com.
