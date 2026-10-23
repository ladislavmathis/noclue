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
- It does not read web pages other than the meeting tab you start it on, where it shows the
  optional cue window.

## The cue window in the meeting page

When you choose **Show cue window**, noclue places the cue in the meeting tab and adds a small
read-only observer to that page. The observer only notices when the meeting page starts or
stops a screen share, so the cue can hide itself. It does not record, change or send anything;
the page receives its own share stream unchanged. The cue in the page receives only the current
answer, never the transcript. The observer is best effort: the meeting page could see it or
bypass it, so always check what is on your shared screen.

## Test mode

If you turn on test mode, questions, answers and timing are kept in memory so you can export
them as a JSON file. Nothing is exported automatically. Stop, Clear test or closing the
extension removes the recording.

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
