import { describe, it, expect } from 'vitest';
import { appendTranscript, pruneSegments } from '@noclue/shared';
describe('local meeting transcript history', () => {
  it('keeps older speech visible while AI context expires and replaces partial text once', () => {
    const old = { id: 'old', sequence: 0, text: 'Earlier meeting discussion', at: 0, final: true };
    const part = { id: 'new', sequence: 1, text: 'A new', at: 400000, final: false };
    const first = appendTranscript([old], part).segments;
    const complete = appendTranscript(first, {
      ...part,
      text: 'A new question',
      final: true,
    }).segments;
    expect(complete).toHaveLength(2);
    expect(pruneSegments(complete, 400000)).toHaveLength(1);
    expect(appendTranscript(complete, { ...part, text: 'Late partial' }).segments).toEqual(
      complete,
    );
  });
  it('reports a safety-limit truncation instead of silently retaining unbounded meeting text', () => {
    const history = Array.from({ length: 50 }, (_, i) => ({
      id: String(i),
      sequence: i,
      text: 'x'.repeat(10000),
      at: i,
      final: true,
    }));
    const result = appendTranscript(history, {
      id: 'next',
      sequence: 51,
      text: 'new',
      at: 51,
      final: true,
    });
    expect(result.truncated).toBe(true);
    expect(result.segments[0].id).toBe('1');
    expect(result.segments.at(-1)?.text).toBe('new');
  });
});
