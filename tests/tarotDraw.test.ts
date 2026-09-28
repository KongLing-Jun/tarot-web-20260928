import { afterEach, describe, expect, it, vi } from 'vitest';
import { allCards } from '@/lib/tarot/cards';
import { drawSupplementaryCards, shuffleCards } from '@/lib/tarot/draw';

afterEach(() => vi.restoreAllMocks());

describe('tarot draws', () => {
  it('gives each four-card permutation one equally likely shuffle path without mutating the input', () => {
    const cards = [1, 2, 3, 4];
    const permutations = new Set<string>();
    for (let first = 0; first < 4; first++) {
      for (let second = 0; second < 3; second++) {
        for (let third = 0; third < 2; third++) {
          const choices = [first / 4, second / 3, third / 2];
          permutations.add(shuffleCards(cards, () => choices.shift()!).join(','));
        }
      }
    }
    expect(permutations.size).toBe(24);
    expect(cards).toEqual([1, 2, 3, 4]);
  });

  it('draws unique cards per round while retaining the existing cross-round repeat policy', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const first = drawSupplementaryCards(3);
    const second = drawSupplementaryCards(3);
    expect(new Set(first.map((draw) => draw.card.id)).size).toBe(3);
    expect(first.map((draw) => draw.card.id)).toEqual(second.map((draw) => draw.card.id));
    expect(first[0].position.id).toBe('supp-1');
    expect(first[0].card).toBe(allCards[1]);
  });
});
