import { connectHub, hubConfigFromSettings, type HubConnection } from '@noclue/core';
import type { Settings } from '@noclue/shared';

type Listener<E> = ((event: E) => void) | null;

/**
 * An in-page stand-in for the WebSocket that used to reach the local backend on
 * 127.0.0.1:4317. The meeting logic now runs in this extension page and calls OpenAI or
 * Anthropic directly with the user's own key, so there is no server to start.
 *
 * It keeps WebSocket semantics the UI code relies on: open, message and close are
 * delivered asynchronously and in order, messages are JSON text, and a close is final.
 */
export class LocalSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readyState: number = LocalSocket.CONNECTING;
  /** Frames are handed over synchronously; nothing is ever buffered. */
  readonly bufferedAmount = 0;
  onopen: Listener<Event> = null;
  onmessage: Listener<MessageEvent<string>> = null;
  onerror: Listener<Event> = null;
  onclose: Listener<CloseEvent> = null;
  private connection: HubConnection;
  private queue: (() => void)[] = [];
  private draining = false;

  constructor(settings: Settings) {
    this.connection = connectHub(hubConfigFromSettings(settings, settings.testMode ?? false), {
      send: (event) => {
        const data = JSON.stringify(event);
        this.enqueue(() => this.onmessage?.(new MessageEvent('message', { data })));
      },
      close: (code, reason) => this.finish(code, reason),
    });
    this.enqueue(() => {
      if (this.readyState !== LocalSocket.CONNECTING) return;
      this.readyState = LocalSocket.OPEN;
      this.onopen?.(new Event('open'));
    });
  }

  send(data: string | ArrayBuffer | ArrayBufferView) {
    if (this.readyState !== LocalSocket.OPEN) return;
    if (typeof data === 'string') return this.connection.receive(data);
    // View the same bytes (an Int16Array of PCM must not be converted element-wise).
    const bytes =
      data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    this.connection.receive(bytes);
  }

  close(code = 1000, reason = '') {
    if (this.readyState >= LocalSocket.CLOSING) return;
    this.connection.closed();
    this.finish(code, reason);
  }

  private finish(code: number, reason: string) {
    if (this.readyState === LocalSocket.CLOSED) return;
    this.readyState = LocalSocket.CLOSED;
    // Events queued before the close (for example a fatal session.error) still arrive first.
    this.enqueue(() => this.onclose?.(new CloseEvent('close', { code, reason, wasClean: true })));
  }

  private enqueue(task: () => void) {
    this.queue.push(task);
    if (this.draining) return;
    this.draining = true;
    setTimeout(() => {
      while (this.queue.length) {
        const next = this.queue.shift()!;
        try {
          next();
        } catch (error) {
          console.error('[noclue] UI handler failed', (error as Error)?.name ?? '');
        }
      }
      this.draining = false;
    }, 0);
  }
}
