import { it, expect } from 'vitest';
import { factsFromContext, pruneSegments, ProjectSchema } from '@noclue/shared';
it('fact IDs survive reordered paragraphs', () => {
  const first = factsFromContext('One fact.\n\nAnother fact.');
  expect(factsFromContext('Another fact.\n\nOne fact.')).toEqual(first.reverse());
});
it('enforces rolling age and character bounds without truncating paragraphs', () => {
  const now = 500000;
  const segments = [
    { id: 'old', sequence: 0, text: 'old', at: 0, final: true },
    { id: 'a', sequence: 1, text: 'a'.repeat(8000), at: now, final: true },
    { id: 'b', sequence: 2, text: 'b'.repeat(8000), at: now, final: true },
  ];
  expect(pruneSegments(segments, now).map((s) => s.id)).toEqual(['b']);
});
it('rejects oversized project input and invalid transcription hints', () => {
  const base = { name: 'Test', role: '', goal: '', context: 'a', keywords: [] };
  expect(ProjectSchema.safeParse({ ...base, context: 'x'.repeat(20001) }).success).toBe(false);
  expect(ProjectSchema.safeParse({ ...base, keywords: ['<bad>'] }).success).toBe(false);
});

it('keeps old projects valid and limits optional personal context', () => {
  const old = { name: 'Test', role: '', goal: '', context: 'a', keywords: [] };
  expect(ProjectSchema.parse(old).aboutMe ?? '').toBe('');
  expect(ProjectSchema.safeParse({ ...old, aboutMe: 'a'.repeat(5000) }).success).toBe(true);
  expect(ProjectSchema.safeParse({ ...old, aboutMe: 'a'.repeat(5001) }).success).toBe(false);
});
