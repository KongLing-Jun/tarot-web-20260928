import { describe, expect, it } from 'vitest';
import { resolveReadingEntry, readingScenes, generalSpreads } from '@/lib/readingEntry';
import { spreads } from '@/lib/tarot/spreads';

const resolve = (query: string) => resolveReadingEntry(new URLSearchParams(query));
describe('reading entry compatibility', () => {
  it('keeps the domain intact while offering four ordered general spreads', () => {
    expect(spreads).toHaveLength(6);
    expect(generalSpreads.map((s) => s.positions.length)).toEqual([1, 3, 5, 10]);
  });
  it.each(spreads)('legacy $id stays preselected without a seeded scene question', (spread) => {
    expect(resolve(`spread=${spread.id}`)).toEqual({ identity: `spread:${spread.id}`, spread });
  });
  it.each(readingScenes)('$id resolves a scene and its existing spread', (scene) => {
    expect(resolve(`scene=${scene.id}&from=home`)).toMatchObject({
      identity: `scene:${scene.id}`,
      scene,
    });
  });
  it.each([
    'scene=',
    'scene=unknown',
    'scene=relationship&scene=relationship',
    'scene=relationship&spread=relationship',
    'scene=two-options&spread=',
    'spread=single&spread=single',
    'spread=missing',
  ])('invalid or ambiguous %s falls back empty', (query) => {
    const entry = resolve(query);
    expect(entry.identity).toBe('general');
    expect(entry.spread).toBeUndefined();
    expect(entry.scene).toBeUndefined();
    expect(entry.warning).toBeTruthy();
  });
});
