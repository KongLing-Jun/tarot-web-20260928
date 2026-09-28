import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useReading } from '@/hooks/useReading';
import { getSpreadById } from '@/lib/tarot/spreads';
import { getReadings } from '@/lib/readingStorage';
import { mockReadingApi } from './helpers/reading-api';

beforeEach(mockReadingApi);
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function ready(spreadId: string) {
  const { result } = renderHook(() => useReading());
  act(() => result.current.setSpread(getSpreadById(spreadId)!));
  act(() => result.current.goToPhase('shuffle'));
  act(() => result.current.startShuffle());
  act(() => result.current.finishShuffle(result.current.shuffleRound));
  act(() => result.current.startDraw());
  return result;
}
function choose(result: ReturnType<typeof ready>, index: number) {
  act(() => result.current.previewCard(index));
  act(() => {
    result.current.confirmCard();
    result.current.confirmCard();
  });
}

describe('抽齐后自动进入逐张揭牌', () => {
  it.each(['single', 'three-card', 'celtic-cross'])(
    '%s 最后一张才进入揭牌，保留牌序与正逆位且未提前揭开或保存',
    async (spreadId) => {
      const result = ready(spreadId);
      const deck = result.current.deck;
      const spread = result.current.spread;
      for (let slot = 0; slot < spread.positions.length; slot++) {
        choose(result, slot * 2);
        expect(result.current.phase).toBe(slot === spread.positions.length - 1 ? 'reveal' : 'draw');
        expect(result.current.slots.filter((index) => index !== null)).toHaveLength(slot + 1);
      }
      expect(result.current.revealedCount).toBe(0);
      expect(result.current.drawnCards).toEqual(
        spread.positions.map((position, i) => ({
          card: deck[i * 2].card,
          isReversed: deck[i * 2].isReversed,
          position,
        })),
      );
      expect(await getReadings()).toEqual([]);
    },
  );

  it('返回调整保持抽牌页；撤回和补选后自动进入揭牌，首次揭牌才保存最终选择', async () => {
    const result = ready('three-card');
    for (const index of [6, 12, 30]) choose(result, index);
    const deck = result.current.deck;
    expect(result.current.phase).toBe('reveal');
    act(() => result.current.returnToDraw());
    expect(result.current.phase).toBe('draw');
    expect(result.current.slots).toEqual([6, 12, 30]);
    act(() => result.current.enterReveal());
    expect(result.current.phase).toBe('reveal');
    act(() => result.current.returnToDraw());
    act(() => result.current.undoCard(2));
    expect(result.current.slots).toEqual([6, 12, null]);
    expect(result.current.deck).toBe(deck);
    choose(result, 32);
    expect(result.current.phase).toBe('reveal');
    expect(result.current.revealedCount).toBe(0);
    expect(await getReadings()).toEqual([]);
    await act(async () => result.current.revealNextCard());
    expect(result.current.revealedCount).toBe(1);
    const records = await getReadings();
    expect(records).toHaveLength(1);
    expect(records[0].drawnCards.map((d) => d.card.id)).toEqual(
      [6, 12, 32].map((i) => deck[i].card.id),
    );
    act(() => result.current.returnToDraw());
    expect(result.current.phase).toBe('reveal');
  });
});
