import { LIMITS, type Project, type Segment } from '@noclue/shared';
import { ProviderError, billingError } from '../recommendations/errors.js';
export interface Transcriber {
  connect(): Promise<void>;
  append(audio: Uint8Array): void;
  commit(accepted?: (sequence: number) => void): void;
  close(): void;
}
export type TranscriberFactory = (
  project: Project,
  onSegment: (s: Segment) => void,
  onError: (e: ProviderError) => void,
) => Transcriber;

export class OpenAITranscriber implements Transcriber {
  private socket?: WebSocket;
  static readonly URL = 'wss://api.openai.com/v1/realtime?intent=transcription';
  private stopped = false;
  private ready = false;
  private sequence = 0;
  private bytes = 0;
  private items = new Map<string, Segment>();
  private acknowledged = new Set<string>();
  private progressTimer?: ReturnType<typeof setInterval>;
  private pending: { sequence: number; at: number }[] = [];
  private rejectConnect?: (error: Error) => void;
  private timeout?: ReturnType<typeof setTimeout>;
  constructor(
    private apiKey: string,
    private model: string,
    private project: Project,
    private onSegment: (s: Segment) => void,
    private onError: (e: ProviderError) => void,
  ) {}
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.rejectConnect = reject;
      // Browsers cannot set an Authorization header on a WebSocket. OpenAI accepts
      // the user's own key as a subprotocol; it never leaves the user's browser
      // except on this TLS connection to api.openai.com.
      let ws: WebSocket;
      try {
        ws = this.socket = new WebSocket(OpenAITranscriber.URL, [
          'realtime',
          `openai-insecure-api-key.${this.apiKey}`,
        ]);
      } catch {
        reject(
          new ProviderError(
            'API_ACCESS',
            'The OpenAI API key has an invalid format. Paste it again in settings.',
          ),
        );
        return;
      }
      this.timeout = setTimeout(
        () =>
          this.fail(
            new ProviderError('TRANSCRIPTION_TIMEOUT', 'Transcription connection timed out.', true),
          ),
        12_000,
      );
      ws.onopen = () =>
        this.send({
          type: 'session.update',
          session: {
            type: 'transcription',
            audio: {
              input: {
                format: { type: 'audio/pcm', rate: 24000 },
                transcription: {
                  model: this.model,
                  languages: ['en'],
                  keywords: this.project.keywords,
                  delay: 'low',
                },
                turn_detection: null,
              },
            },
          },
        });
      // A healthy WebSocket can still stop producing transcripts. Bound both
      // unacknowledged commits and acknowledged items awaiting a final result.
      this.progressTimer = setInterval(() => {
        const cutoff = Date.now() - 30000;
        if (
          this.pending.some((p) => p.at < cutoff) ||
          [...this.items.values()].some((item) => !item.final && item.at < cutoff)
        )
          this.fail(
            new ProviderError(
              'TRANSCRIPTION_STALLED',
              'Transcription stopped making progress. Reconnecting.',
              true,
            ),
          );
      }, 1000);
      ws.onmessage = (message) => {
        if (this.stopped) return;
        let event: any;
        try {
          event = JSON.parse(String(message.data));
        } catch {
          return this.fail(
            new ProviderError('TRANSCRIPTION_PROTOCOL', 'Invalid transcription response.', true),
          );
        }
        if (event.type === 'session.updated') {
          this.ready = true;
          clearTimeout(this.timeout);
          this.rejectConnect = undefined;
          resolve();
          return;
        }
        if (event.type === 'error') {
          const code = String(event.error?.code || '');
          const billing = billingError(code, event.error?.type);
          if (billing) return this.fail(billing);
          // A rejected append/commit affects one segment, not the connection.
          // Settle the oldest outstanding commit so the session does not wait for it.
          if (code.startsWith('input_audio_buffer')) {
            const sent = this.pending.shift();
            if (sent)
              this.onSegment({ id: `rejected-${sent.sequence}`, text: '', final: true, ...sent });
            return;
          }
          const denied = /auth|permission|model|invalid|unsupported/.test(code);
          return this.fail(
            new ProviderError(
              denied ? 'API_ACCESS' : 'TRANSCRIPTION_ERROR',
              denied
                ? 'OpenAI rejected the transcription model or key. Check the key and model access in settings.'
                : 'Transcription failed. Reconnecting.',
              !denied,
            ),
          );
        }
        if (event.type === 'input_audio_buffer.committed') {
          if (typeof event.item_id !== 'string' || this.acknowledged.has(event.item_id)) return;
          const sent = this.pending.shift();
          if (!sent) return;
          const item: Segment = {
            id: event.item_id,
            text: '',
            final: false,
            ...this.items.get(event.item_id),
            ...sent,
          };
          this.acknowledged.add(event.item_id);
          this.items.set(event.item_id, item);
          // A completed transcript may precede the commit acknowledgement.
          // Publish its final form only once its source order is known.
          if (item.text || item.final) this.onSegment({ ...item });
          return;
        }
        // A failed segment is finalized with whatever partial text arrived; the
        // session keeps running instead of reconnecting and clearing the transcript.
        if (
          event.type === 'conversation.item.input_audio_transcription.delta' ||
          event.type === 'conversation.item.input_audio_transcription.completed' ||
          event.type === 'conversation.item.input_audio_transcription.failed'
        ) {
          if (typeof event.item_id !== 'string') return;
          let item = this.items.get(event.item_id);
          // Deltas can arrive before commit with live transcription. The current sequence
          // is reserved until commit, and committed events retain that same sequence.
          if (!item) {
            const pending = this.pending[0];
            item = {
              id: event.item_id,
              sequence: pending?.sequence ?? this.sequence,
              at: pending?.at ?? Date.now(),
              text: '',
              final: false,
            };
            this.items.set(event.item_id, item);
          }
          if (item.final) return;
          const final = !event.type.endsWith('.delta');
          const text = event.type.endsWith('.completed')
            ? event.transcript
            : item.text + (!final && typeof event.delta === 'string' ? event.delta : '');
          if (typeof text !== 'string') return;
          item = { ...item, text: text.slice(0, LIMITS.transcriptChars), final };
          this.items.set(event.item_id, item);
          if (!final || this.acknowledged.has(item.id)) this.onSegment({ ...item });
          for (const [id, s] of this.items)
            if (s.at < Date.now() - LIMITS.transcriptMs) {
              this.items.delete(id);
              this.acknowledged.delete(id);
            }
          while (this.items.size > 256) {
            const oldest = this.items.keys().next().value!;
            this.items.delete(oldest);
            this.acknowledged.delete(oldest);
          }
        }
      };
      // A rejected handshake (bad key, no model access) surfaces only as error + close
      // in browsers; the HTTP status is not exposed. Settings → Test key reports the cause.
      ws.onerror = () =>
        this.fail(
          new ProviderError('TRANSCRIPTION_CONNECTION', 'Transcription connection failed.', true),
        );
      ws.onclose = () => {
        if (!this.stopped)
          this.fail(
            new ProviderError('TRANSCRIPTION_CLOSED', 'Transcription connection ended.', true),
          );
      };
    });
  }
  private send(event: unknown) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(event));
  }
  append(audio: Uint8Array) {
    if (!this.ready || this.stopped) return;
    // Drop frames while the uplink is congested; a dead socket is caught by the progress timer or close event.
    if ((this.socket?.bufferedAmount ?? 0) > LIMITS.audioQueueBytes * 1.4) return;
    this.bytes += audio.length;
    this.send({ type: 'input_audio_buffer.append', audio: toBase64(audio) });
  }
  commit(accepted?: (sequence: number) => void) {
    if (!this.ready || this.stopped || this.bytes < 4800) return;
    if (this.pending.length >= 32)
      return this.fail(
        new ProviderError(
          'TRANSCRIPTION_STALLED',
          'Transcription acknowledgements fell behind. Reconnecting.',
          true,
        ),
      );
    const sequence = this.sequence++;
    this.pending.push({ sequence, at: Date.now() });
    accepted?.(sequence);
    this.bytes = 0;
    this.send({ type: 'input_audio_buffer.commit' });
  }
  private fail(error: ProviderError) {
    if (this.stopped) return;
    const reject = this.rejectConnect;
    this.rejectConnect = undefined;
    this.close();
    if (reject) reject(error);
    else this.onError(error);
  }
  close() {
    this.stopped = true;
    this.ready = false;
    clearTimeout(this.timeout);
    clearInterval(this.progressTimer);
    const reject = this.rejectConnect;
    this.rejectConnect = undefined;
    reject?.(new ProviderError('CANCELLED', 'Transcription stopped.'));
    this.socket?.close();
    this.items.clear();
    this.acknowledged.clear();
    this.pending = [];
    this.bytes = 0;
  }
}

/** Base64 for PCM frames without Node's Buffer. Frames are at most 9,600 bytes. */
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
