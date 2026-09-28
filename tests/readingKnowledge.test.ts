import { describe, expect, it } from 'vitest';
import { allCards } from '@/lib/tarot/cards';
import { getReadingKnowledge } from '@/lib/tarot/reading-knowledge';

describe('offline reading knowledge experiment', () => {
  it('covers every canonical card and direction without changing the deck', () => {
    const before = JSON.stringify(allCards);
    expect(allCards).toHaveLength(78);
    for (const card of allCards)
      for (const reversed of [false, true]) {
        const entry = getReadingKnowledge(card.id, reversed);
        expect(entry.cardId).toBe(card.id);
        expect(entry.orientation).toBe(reversed ? 'reversed' : 'upright');
        expect(entry.focus).toBeTruthy();
        expect(entry.focus).not.toContain('undefined');
        expect(entry.source).toBeTruthy();
        expect(entry.reviewStatus).toBe('experimental');
        if (card.type === 'minor' && card.number > 10) expect(entry.boundary).toContain('宫廷牌');
      }
    expect(JSON.stringify(allCards)).toBe(before);
  });

  it('rejects unknown cards instead of inventing a meaning', () => {
    expect(() => getReadingKnowledge('not-a-card', false)).toThrow('未知牌面');
  });
});
