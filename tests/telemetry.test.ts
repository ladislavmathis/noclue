import { expect, it } from 'vitest';
import { SessionRecorder } from '../apps/extension/src/connection/telemetry';

it('Stop removes test content and diagnostics and cannot resume the old recording', () => {
  const recorder = new SessionRecorder();
  const event = {
    kind: 'generation.finished',
    at: 2,
    sessionId: 'synthetic',
    question: 'Private question',
    answer: 'Private answer',
  };
  recorder.start(true, 1);
  recorder.add(event);
  expect(recorder.log?.events).toEqual([event]);
  expect(recorder.diagnostics).toHaveLength(1);
  recorder.stop();
  expect(recorder.log).toBeUndefined();
  expect(recorder.diagnostics).toEqual([]);
  recorder.add(event);
  expect(recorder.log).toBeUndefined();
  recorder.start(true, 3);
  expect(recorder.log?.events).toEqual([]);
  expect(recorder.diagnostics).toEqual([]);
});
