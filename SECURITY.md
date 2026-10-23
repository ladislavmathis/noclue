# Security

noclue runs entirely in the user's browser with the user's own API keys. Please report anything
that could expose keys, meeting audio, transcripts or project facts, or that sends data
anywhere other than api.openai.com and api.anthropic.com.

Report privately through GitHub's "Report a vulnerability" (Security tab of the repository).
Please do not open a public issue. We aim to reply within seven days.

Known by design:

- API keys are stored in `chrome.storage.local`, which Chrome does not encrypt. Anyone with
  access to the Chrome profile can read them. Users should use a dedicated key with a spending
  limit.
- The OpenAI key is sent as a WebSocket subprotocol for realtime transcription, because
  browsers cannot set an Authorization header on WebSockets. It travels only over TLS to
  api.openai.com.
- The optional cue is part of the meeting page's DOM (including its Picture-in-Picture window).
  Page scripts can read it; Shadow DOM is styling isolation, not a security boundary. Use the
  extension side panel for sensitive information. Screen-share observation is best effort and
  cannot detect sharing started by another app.
