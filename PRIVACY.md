# noclue privacy policy

_Last updated: 23 October 2026. Applies to the noclue by ignition Chrome extension, version 0.4
and later._

noclue is a Chrome extension that helps you answer questions during online meetings. It has no
server, no user accounts and no analytics. noclue is developed by ignition.sk
(https://ignition.sk). The developer receives none of your data.

## What noclue processes and where it goes

| Data                                                               | When                                                        | Sent to                                                                | Stored                                          |
| ------------------------------------------------------------------ | ----------------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------- |
| Audio of the meeting tab you choose                                | Only while you are listening                                | OpenAI, for live transcription                                         | Never written to disk                           |
| Your microphone                                                    | Only while you are listening, or during the microphone test | Nowhere. It is analysed on your computer only to detect when you speak | Never                                           |
| Recent meeting transcript (up to 5 minutes)                        | When an answer is prepared                                  | OpenAI or Anthropic, whichever you choose                              | In memory until you press Stop                  |
| Project facts, role, meeting goal and "About me" profile you enter | When an answer is prepared or you try a practice question   | OpenAI or Anthropic, whichever you choose                              | In this Chrome profile (`chrome.storage.local`) |
| Your API keys                                                      | When noclue calls the provider                              | Only to the provider the key belongs to                                | In this Chrome profile (`chrome.storage.local`) |
| Preferences, microphone choice, cue window position                | Never sent                                                  | Nowhere                                                                | In this Chrome profile                          |

Requests go directly from your browser to `api.openai.com` and, if you choose Anthropic,
`api.anthropic.com`. They are made with your own API keys under your own agreements with those
providers. Their policies apply to what they receive:

- OpenAI: https://openai.com/policies/privacy-policy and https://openai.com/enterprise-privacy
- Anthropic: https://www.anthropic.com/legal/privacy and https://www.anthropic.com/legal/commercial-terms

noclue asks OpenAI not to store answer requests (`store: false`). This does not guarantee that a
provider keeps no data. Check your provider account's data retention settings.

## What noclue does not do

- It does not record or save meeting audio.
- It does not send your microphone audio anywhere.
- It does not sell, share or transfer data to anyone, and uses no data for advertising or
  creditworthiness.
- It does not collect analytics, crash reports or usage statistics.
- On supported Meet and Teams pages, a small observer starts when the page loads. It observes
  screen-share start/end and the surface type (tab, window or screen), so the optional cue can
  hide even when sharing started before you opened it. It does not read meeting content, start
  capture, or send this information anywhere.

The optional in-page cue puts the displayed question and answer into the meeting page's DOM,
where that page's scripts can read them. Its pop-out uses the same page context. Use the
extension side panel for sensitive information. Screen-share detection is best effort; shares
started outside the meeting page are not detected. A whole-screen share can show the side panel.

## Test mode

If you turn on test mode, questions, answers and timing are kept in memory so you can export
them as a JSON file. Nothing is exported automatically. Export before pressing Stop if you
want to keep a copy. Stop and Clear test remove the in-memory recording, including on an error
that stops listening. Closing only the side panel does not stop listening or clear the recording.
Previously downloaded exports remain on your device until you delete them.

## Your choices

- Press **Stop** at any time to end listening and clear the transcript.
- Delete your keys and project in Settings, or remove the extension to delete everything it
  stored.
- Revoke an API key in your OpenAI or Anthropic account at any time.

## Other people in your meeting

Transcribing other participants may require their consent under the law where you or they
are. You are responsible for informing participants and obtaining consent where required.

## Children

noclue is not directed at children under 16.

## Changes and contact

Changes to this policy are published in this file and noted in the changelog. Questions:
open an issue at the project's GitHub repository or use the contact address in the Chrome Web
Store listing.
