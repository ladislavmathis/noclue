import { describe, expect, it, vi } from 'vitest';
import { PROTOCOL_VERSION, type ServerEvent } from '@noclue/shared';
import { connectHub, type HubConfig } from '../packages/core/src/hub';
import type { Transcriber } from '../packages/core/src/realtime/transcriber';

const project = {
  name: 'Fictional hub fixture',
  role: 'Lead',
  goal: 'Clarify scope',
  context: 'A pilot is planned but not yet completed.',
  keywords: [],
};
const skip = {
  action: 'skip' as const,
  responseType: 'none' as const,
  category: 'none' as const,
  triggerSegmentIds: [],
  topicKey: '',
  recommendation: '',
  suggestedResponse: '',
  groundedFactIds: [],
  missingInformation: [],
};
function harness(overrides: Partial<HubConfig> = {}) {
  const events: ServerEvent[] = [];
  const closes: { code: number; reason: string }[] = [];
  const frames: Uint8Array[] = [];
  const transcriber: Transcriber = {
    connect: vi.fn(async () => {}),
    append: vi.fn((audio: Uint8Array) => void frames.push(audio)),
    commit: vi.fn(),
    close: vi.fn(),
  };
  const config: HubConfig = {
    configured: true,
    recommend: vi.fn(async () => skip),
    transcriber: vi.fn(() => transcriber),
    ...overrides,
  };
  const connection = connectHub(config, {
    send: (event) => events.push(event),
    close: (code, reason) => closes.push({ code, reason }),
  });
  const json = (message: unknown) => connection.receive(JSON.stringify(message));
  const authenticate = () => json({ type: 'authenticate', protocolVersion: PROTOCOL_VERSION });
  return { config, connection, events, closes, frames, transcriber, json, authenticate };
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const sessionId = '00000000-0000-4000-8000-000000000001';

describe('in-extension hub', () => {
  it('needs no pairing token and rejects audio before authentication', () => {
    const h = harness();
    h.connection.receive(new Uint8Array(480));
    expect(h.closes).toEqual([{ code: 1008, reason: 'Audio not allowed' }]);
    const g = harness();
    g.authenticate();
    expect(g.events).toEqual([{ type: 'authenticated', protocolVersion: PROTOCOL_VERSION }]);
    expect(g.closes).toEqual([]);
  });
  it('rejects an old protocol with a plain reload instruction before opening AI', () => {
    const h = harness();
    h.json({ type: 'authenticate', protocolVersion: PROTOCOL_VERSION - 1 });
    expect(h.events[0]).toMatchObject({ type: 'session.error', code: 'PROTOCOL_VERSION' });
    expect((h.events[0] as any).message).toContain('Reload noclue');
    expect(h.config.transcriber).not.toHaveBeenCalled();
  });
  it('starts a session, forwards PCM bytes unchanged, allows one meeting and cleans up on stop', async () => {
    const h = harness();
    h.authenticate();
    h.json({ type: 'session.start', sessionId, project, micAvailable: true });
    await flush();
    expect(h.events.at(-1)).toEqual({ type: 'session.ready', sessionId });
    const pcm = new Uint8Array([1, 2, 3, 4]);
    h.connection.receive(pcm);
    h.connection.receive(pcm.buffer);
    expect(h.frames.map((f) => [...f])).toEqual([
      [1, 2, 3, 4],
      [1, 2, 3, 4],
    ]);
    const other = harness();
    other.authenticate();
    other.json({
      type: 'session.start',
      sessionId: '00000000-0000-4000-8000-000000000002',
      project,
      micAvailable: true,
    });
    expect(other.events.at(-1)).toMatchObject({ code: 'SESSION_BUSY' });
    h.json({ type: 'session.stop', sessionId });
    expect(h.transcriber.close).toHaveBeenCalled();
    expect(h.events.at(-1)).toEqual({ type: 'session.stopped', sessionId });
    expect(h.closes.at(-1)).toEqual({ code: 1000, reason: 'Stopped' });
    // The single-meeting slot is free again.
    const third = harness();
    third.authenticate();
    third.json({ type: 'session.start', sessionId, project, micAvailable: true });
    await flush();
    expect(third.events.at(-1)).toEqual({ type: 'session.ready', sessionId });
    third.connection.closed();
    expect(third.transcriber.close).toHaveBeenCalled();
  });
  it('rejects odd-length or oversize PCM frames', async () => {
    const h = harness();
    h.authenticate();
    h.json({ type: 'session.start', sessionId, project, micAvailable: true });
    await flush();
    h.connection.receive(new Uint8Array(3));
    expect(h.closes.at(-1)).toEqual({ code: 1008, reason: 'Invalid PCM frame' });
    h.connection.closed();
  });
  it('explains missing API keys in plain words and opens nothing', () => {
    const h = harness({ configured: false, setupProblem: 'Add your OpenAI API key.' });
    h.authenticate();
    h.json({ type: 'session.start', sessionId, project, micAvailable: true });
    expect(h.events.at(-1)).toMatchObject({
      type: 'session.error',
      code: 'NOT_CONFIGURED',
      message: 'Add your OpenAI API key.',
    });
    expect(h.config.transcriber).not.toHaveBeenCalled();
  });
  it('preflight checks transcription and one answer without audio, then frees the slot', async () => {
    const h = harness();
    h.authenticate();
    h.json({ type: 'connection.check' });
    await vi.waitFor(() => expect(h.events.at(-1)).toEqual({ type: 'connection.checked' }));
    expect(h.transcriber.connect).toHaveBeenCalledTimes(1);
    expect(h.transcriber.append).not.toHaveBeenCalled();
    expect(h.config.recommend).toHaveBeenCalledTimes(1);
    await vi.waitFor(() =>
      expect(h.closes.at(-1)).toEqual({ code: 1000, reason: 'Check complete' }),
    );
    const next = harness();
    next.authenticate();
    next.json({ type: 'session.start', sessionId, project, micAvailable: true });
    await flush();
    expect(next.events.at(-1)).toEqual({ type: 'session.ready', sessionId });
    next.connection.closed();
  });
  it('practice preview uses the supplied project and never opens transcription', async () => {
    const h = harness();
    h.authenticate();
    h.json({ type: 'context.preview', project, question: 'Is the pilot done?' });
    await vi.waitFor(() =>
      expect(h.events.at(-1)).toEqual({ type: 'context.preview.ready', decision: skip }),
    );
    expect(h.config.transcriber).not.toHaveBeenCalled();
    expect((h.config.recommend as any).mock.calls[0][0].project).toEqual(project);
  });
  it('answers clock sync for latency telemetry', () => {
    const h = harness();
    h.authenticate();
    h.json({ type: 'clock.sync', sentAt: 123 });
    expect(h.events.at(-1)).toMatchObject({ type: 'clock.synced', sentAt: 123 });
  });
});
