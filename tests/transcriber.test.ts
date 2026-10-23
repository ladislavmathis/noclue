import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
const state = vi.hoisted(() => ({ socket: null as any, url: '', protocols: [] as string[] }));
// Browser WebSocket stand-in: property handlers, no ping/pong, no custom headers.
class FakeWebSocket {
  static OPEN = 1;
  readyState = 1;
  bufferedAmount = 0;
  sent: any[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(url: string, protocols: string[]) {
    state.socket = this;
    state.url = url;
    state.protocols = protocols;
  }
  send(text: string) {
    this.sent.push(JSON.parse(text));
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
}
vi.stubGlobal('WebSocket', FakeWebSocket);
import { OpenAITranscriber } from '../packages/core/src/realtime/transcriber';
const project = {
  name: 'Test',
  role: '',
  goal: '',
  context: 'Test context',
  keywords: ['NOCLUE_FIXTURE'],
};
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
const event = (data: unknown) => state.socket.onmessage?.({ data: JSON.stringify(data) });
async function setup() {
  const segments: any[] = [],
    errors: any[] = [];
  const provider = new OpenAITranscriber(
    'not-real',
    'gpt-live-transcribe',
    project,
    (s) => segments.push(s),
    (e) => errors.push(e),
  );
  const connected = provider.connect();
  state.socket.onopen?.();
  event({ type: 'session.updated' });
  await connected;
  return { provider, segments, errors };
}
describe('Realtime transcription protocol', () => {
  it('stops retrying when API credits are exhausted', async () => {
    const { provider, errors } = await setup();
    event({
      type: 'error',
      error: { code: 'credit_balance_exhausted', type: 'insufficient_quota' },
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ code: 'API_BILLING', retryable: false });
    expect(errors[0].message).toContain('Add credits');
    expect(state.socket.readyState).toBe(3);
    provider.close();
  });
  it('uses client VAD, PCM 24k and preserves deltas arriving before commit', async () => {
    const { provider, segments } = await setup();
    expect(state.socket.sent[0].session.audio.input.turn_detection).toBeNull();
    expect(state.socket.sent[0].session.audio.input.format.rate).toBe(24000);
    provider.append(Buffer.alloc(4800));
    event({
      type: 'conversation.item.input_audio_transcription.delta',
      item_id: 'a',
      delta: 'Hello',
    });
    provider.commit();
    event({ type: 'input_audio_buffer.committed', item_id: 'a' });
    event({
      type: 'conversation.item.input_audio_transcription.delta',
      item_id: 'a',
      delta: ' world',
    });
    expect(segments.at(-1).text).toBe('Hello world');
    provider.close();
  });
  it('assigns source order when final transcripts arrive out of order and ignores duplicate final', async () => {
    const { provider, segments } = await setup();
    for (const id of ['a', 'b']) {
      provider.append(Buffer.alloc(4800));
      provider.commit();
      event({ type: 'input_audio_buffer.committed', item_id: id });
    }
    for (const id of ['b', 'a', 'b'])
      event({
        type: 'conversation.item.input_audio_transcription.completed',
        item_id: id,
        transcript: id,
      });
    expect(segments.map((s) => [s.id, s.sequence])).toEqual([
      ['b', 1],
      ['a', 0],
    ]);
    provider.close();
  });
  it('avoids empty commits and drops audio instead of ending the session on backpressure', async () => {
    const { provider, errors } = await setup();
    provider.commit();
    expect(state.socket.sent).toHaveLength(1);
    state.socket.bufferedAmount = 200000;
    provider.append(Buffer.alloc(4800));
    expect(state.socket.sent).toHaveLength(1);
    state.socket.bufferedAmount = 0;
    provider.append(Buffer.alloc(4800));
    expect(state.socket.sent).toHaveLength(2);
    expect(errors).toHaveLength(0);
    expect(state.socket.readyState).toBe(1);
    provider.close();
  });
  it('finalizes a failed segment with its partial text and keeps the session open', async () => {
    const { provider, segments, errors } = await setup();
    provider.append(Buffer.alloc(4800));
    provider.commit();
    event({ type: 'input_audio_buffer.committed', item_id: 'a' });
    event({
      type: 'conversation.item.input_audio_transcription.delta',
      item_id: 'a',
      delta: 'What is',
    });
    event({ type: 'conversation.item.input_audio_transcription.failed', item_id: 'a' });
    expect(segments.at(-1)).toMatchObject({ id: 'a', text: 'What is', final: true, sequence: 0 });
    // A late completion does not reopen the finalized segment.
    event({
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'a',
      transcript: 'other',
    });
    expect(segments.at(-1).text).toBe('What is');
    expect(errors).toHaveLength(0);
    expect(state.socket.readyState).toBe(1);
    await vi.advanceTimersByTimeAsync(31_000);
    expect(errors).toHaveLength(0);
    provider.close();
  });
  it('publishes a failed segment that arrives before its commit acknowledgement', async () => {
    const { provider, segments, errors } = await setup();
    provider.append(Buffer.alloc(4800));
    provider.commit();
    event({ type: 'conversation.item.input_audio_transcription.failed', item_id: 'a' });
    expect(segments).toHaveLength(0);
    event({ type: 'input_audio_buffer.committed', item_id: 'a' });
    expect(segments).toEqual([expect.objectContaining({ id: 'a', text: '', final: true })]);
    expect(errors).toHaveLength(0);
    provider.close();
  });
  it('settles a rejected commit without reconnecting', async () => {
    const { provider, segments, errors } = await setup();
    provider.append(Buffer.alloc(4800));
    provider.commit();
    event({ type: 'error', error: { code: 'input_audio_buffer_commit_empty' } });
    expect(segments).toEqual([expect.objectContaining({ sequence: 0, text: '', final: true })]);
    await vi.advanceTimersByTimeAsync(31_000);
    expect(errors).toHaveLength(0);
    expect(state.socket.readyState).toBe(1);
    provider.close();
  });
  it('still reconnects on a general provider error', async () => {
    const { errors } = await setup();
    event({ type: 'error', error: { code: 'server_error' } });
    expect(errors[0]).toMatchObject({ code: 'TRANSCRIPTION_ERROR', retryable: true });
  });
  it('cancels an unfinished connection cleanly', async () => {
    const provider = new OpenAITranscriber(
      'x',
      'model',
      project,
      () => {},
      () => {},
    );
    const pending = provider.connect();
    provider.close();
    await expect(pending).rejects.toHaveProperty('code', 'CANCELLED');
  });
});

it('does not publish a final with provisional ordering and ignores duplicate acknowledgements', async () => {
  const { provider, segments } = await setup();
  for (let i = 0; i < 2; i++) {
    provider.append(Buffer.alloc(4800));
    provider.commit();
  }
  event({
    type: 'conversation.item.input_audio_transcription.completed',
    item_id: 'b',
    transcript: 'second',
  });
  expect(segments).toEqual([]);
  event({ type: 'input_audio_buffer.committed', item_id: 'a' });
  event({ type: 'input_audio_buffer.committed', item_id: 'a' });
  event({ type: 'input_audio_buffer.committed', item_id: 'b' });
  expect(segments.map((s) => [s.id, s.sequence, s.final])).toEqual([['b', 1, true]]);
  provider.close();
});
it('recovers when acknowledgements stop even while the socket stays open', async () => {
  const { provider, errors } = await setup();
  provider.append(Buffer.alloc(4800));
  provider.commit();
  await vi.advanceTimersByTimeAsync(31000);
  expect(errors).toHaveLength(1);
  expect(errors[0].code).toBe('TRANSCRIPTION_STALLED');
  expect(state.socket.readyState).toBe(3);
});
it('recovers when an acknowledged item never finishes', async () => {
  const { provider, errors } = await setup();
  provider.append(Buffer.alloc(4800));
  provider.commit();
  event({ type: 'input_audio_buffer.committed', item_id: 'stuck' });
  await vi.advanceTimersByTimeAsync(31000);
  expect(errors[0].code).toBe('TRANSCRIPTION_STALLED');
});
it('bounds unacknowledged commits without waiting for the deadline', async () => {
  const { provider, errors } = await setup();
  for (let i = 0; i < 40; i++) {
    provider.append(Buffer.alloc(4800));
    provider.commit();
  }
  expect(errors).toHaveLength(1);
  expect(state.socket.sent.filter((e: any) => e.type === 'input_audio_buffer.commit')).toHaveLength(
    32,
  );
});

it('publishes an empty finalized tail after acknowledgement so pending audio can drain', async () => {
  const { provider, segments } = await setup();
  provider.append(Buffer.alloc(4800));
  provider.commit();
  event({
    type: 'conversation.item.input_audio_transcription.completed',
    item_id: 'silence',
    transcript: '',
  });
  expect(segments).toHaveLength(0);
  event({ type: 'input_audio_buffer.committed', item_id: 'silence' });
  expect(segments).toEqual([expect.objectContaining({ id: 'silence', text: '', final: true })]);
  provider.close();
});

it('acknowledges only audio commits actually sent, using source sequence identity', async () => {
  const { provider } = await setup();
  const accepted = vi.fn();
  provider.commit(accepted);
  provider.append(Buffer.alloc(2000));
  provider.commit(accepted);
  expect(accepted).not.toHaveBeenCalled();
  provider.append(Buffer.alloc(2800));
  provider.commit(accepted);
  provider.append(Buffer.alloc(4800));
  provider.commit(accepted);
  expect(accepted.mock.calls).toEqual([[0], [1]]);
  provider.close();
});

it('authenticates like a browser: key in a subprotocol, never in a header', async () => {
  const { provider } = await setup();
  expect(state.url).toBe('wss://api.openai.com/v1/realtime?intent=transcription');
  expect(state.protocols).toEqual(['realtime', 'openai-insecure-api-key.not-real']);
  provider.close();
});

it('sends PCM as base64 without Node Buffer', async () => {
  const { toBase64 } = await import('../packages/core/src/realtime/transcriber');
  const bytes = new Uint8Array([0, 1, 2, 250, 255]);
  expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
  const big = new Uint8Array(70000).map((_, i) => i % 256);
  expect(toBase64(big)).toBe(Buffer.from(big).toString('base64'));
  const { provider } = await setup();
  provider.append(new Uint8Array([1, 2, 3, 4]));
  expect(state.socket.sent.at(-1)).toEqual({
    type: 'input_audio_buffer.append',
    audio: 'AQIDBA==',
  });
  provider.close();
});
