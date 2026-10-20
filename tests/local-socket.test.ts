import { describe, expect, it, vi } from 'vitest';
import { PROTOCOL_VERSION } from '@noclue/shared';

const hub = vi.hoisted(() => ({
  transport: undefined as any,
  received: [] as unknown[],
  closed: 0,
}));
vi.mock('@noclue/core', () => ({
  hubConfigFromSettings: () => ({}),
  connectHub: (_config: unknown, transport: unknown) => {
    hub.transport = transport;
    hub.received = [];
    hub.closed = 0;
    return {
      receive: (data: unknown) => hub.received.push(data),
      closed: () => hub.closed++,
    };
  },
}));
if (typeof globalThis.CloseEvent === 'undefined')
  vi.stubGlobal(
    'CloseEvent',
    class extends Event {
      code: number;
      reason: string;
      wasClean: boolean;
      constructor(type: string, init: { code: number; reason: string; wasClean: boolean }) {
        super(type);
        ({ code: this.code, reason: this.reason, wasClean: this.wasClean } = init);
      }
    },
  );
import { LocalSocket } from '../apps/extension/src/connection/local';

const settings = {
  openaiKey: 'sk-test',
  anthropicKey: '',
  answerProvider: 'openai',
  answerModel: '',
  microphoneId: '',
  project: { name: 'x', role: '', goal: '', context: 'y', keywords: [] },
} as any;
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe('LocalSocket', () => {
  it('opens asynchronously like a WebSocket and delivers JSON events in order', async () => {
    const socket = new LocalSocket(settings);
    const seen: string[] = [];
    expect(socket.readyState).toBe(LocalSocket.CONNECTING);
    socket.onopen = () => seen.push('open');
    socket.onmessage = (event) => seen.push(JSON.parse(event.data).type);
    await tick();
    expect(socket.readyState).toBe(LocalSocket.OPEN);
    socket.send(JSON.stringify({ type: 'authenticate', protocolVersion: PROTOCOL_VERSION }));
    expect(hub.received[0]).toBe(
      JSON.stringify({ type: 'authenticate', protocolVersion: PROTOCOL_VERSION }),
    );
    hub.transport.send({ type: 'authenticated', protocolVersion: PROTOCOL_VERSION });
    hub.transport.send({ type: 'clock.synced', sentAt: 1, serverAt: 2 });
    expect(seen).toEqual(['open']);
    await tick();
    expect(seen).toEqual(['open', 'authenticated', 'clock.synced']);
  });
  it('delivers a fatal error before the close and refuses sends after it', async () => {
    const socket = new LocalSocket(settings);
    const seen: string[] = [];
    socket.onmessage = (event) => seen.push(JSON.parse(event.data).type);
    socket.onclose = (event) => seen.push(`close ${event.code}`);
    await tick();
    hub.transport.send({
      type: 'session.error',
      code: 'X',
      message: 'm',
      fatal: true,
      retryable: false,
    });
    hub.transport.close(1011, 'Session ended');
    expect(socket.readyState).toBe(LocalSocket.CLOSED);
    socket.send('{"type":"clock.sync","sentAt":1}');
    await tick();
    expect(seen).toEqual(['session.error', 'close 1011']);
    expect(hub.received).toEqual([]);
  });
  it('passes PCM as the same bytes, even from an Int16Array view', async () => {
    const socket = new LocalSocket(settings);
    await tick();
    const samples = new Int16Array([1, -1, 300]);
    socket.send(samples);
    const bytes = hub.received[0] as Uint8Array;
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.byteLength).toBe(6);
    expect(new Int16Array(bytes.buffer, bytes.byteOffset, 3)).toEqual(samples);
  });
  it('tells the hub when the page closes it', async () => {
    const socket = new LocalSocket(settings);
    let closed = 0;
    socket.onclose = () => closed++;
    await tick();
    socket.close();
    socket.close();
    await tick();
    expect(hub.closed).toBe(1);
    expect(closed).toBe(1);
  });
});
