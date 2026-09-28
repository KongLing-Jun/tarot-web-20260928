import { describe, expect, it, vi, afterEach } from 'vitest';
import { allCards } from '@/lib/tarot/cards';
import { createShuffledDeck } from '@/lib/tarot/draw';
import { initialDrawState, reduceDraw } from '@/lib/tarot/manual-draw';
import { spreads } from '@/lib/tarot/spreads';

afterEach(() => vi.restoreAllMocks());
const spread = spreads.find((s) => s.id === 'three-card')!;

function ready() {
  let state = reduceDraw(initialDrawState, { type: 'navigate', phase: 'shuffle' });
  state = reduceDraw(state, {
    type: 'shuffle',
    deck: createShuffledDeck(),
    count: spread.positions.length,
  });
  state = reduceDraw(state, { type: 'shuffled', round: state.round });
  expect(state.phase).toBe('shuffle');
  expect(state.slots).toEqual([null, null, null]);
  return reduceDraw(state, { type: 'start-draw' });
}

describe('完整牌堆与手动选牌', () => {
  it('Fisher–Yates 使用可控随机数，不改变原数组且覆盖全部卡牌', () => {
    const ids = allCards.map((c) => c.id);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const deck = createShuffledDeck();
    expect(deck.map((c) => c.card.id)).toEqual([...ids.slice(1), ids[0]]);
    expect(allCards.map((c) => c.id)).toEqual(ids);
    expect(new Set(deck.map((c) => c.card.id)).size).toBe(allCards.length);
    expect(deck.every((c, i) => c.deckIndex === i && !c.isReversed)).toBe(true);
  });

  it('预选不抽取，确认防重复，撤回保留其他阵位并填补空位', () => {
    let state = ready();
    const deck = state.deck;
    state = reduceDraw(state, { type: 'preview', index: 6 });
    expect(state.slots.every((c) => c === null)).toBe(true);
    state = reduceDraw(state, { type: 'confirm' });
    state = reduceDraw(state, { type: 'confirm' });
    expect(state.slots).toEqual([6, null, null]);
    for (const index of [12, 30]) {
      state = reduceDraw(state, { type: 'preview', index });
      state = reduceDraw(state, { type: 'confirm' });
    }
    state = reduceDraw(state, { type: 'undo', slot: 1 });
    expect(state.slots).toEqual([6, null, 30]);
    state = reduceDraw(state, { type: 'preview', index: 12 });
    state = reduceDraw(state, { type: 'confirm' });
    expect(state.slots).toEqual([6, 12, 30]);
    expect(state.deck).toBe(deck);
    expect(reduceDraw(state, { type: 'preview', index: 2 })).toBe(state);
  });

  it.each(spreads)('$nameCn 必须选齐才能揭牌，首次揭牌后不能撤回或返回', (s) => {
    let state = reduceDraw(initialDrawState, { type: 'navigate', phase: 'shuffle' });
    state = reduceDraw(state, {
      type: 'shuffle',
      deck: createShuffledDeck(),
      count: s.positions.length,
    });
    const round = state.round;
    expect(reduceDraw(state, { type: 'shuffled', round: round - 1 })).toBe(state);
    state = reduceDraw(state, { type: 'shuffled', round });
    state = reduceDraw(state, { type: 'start-draw' });
    expect(reduceDraw(state, { type: 'enter-reveal', spread: s })).toBe(state);
    for (let index = 0; index < s.positions.length; index++) {
      state = reduceDraw(state, { type: 'preview', index });
      state = reduceDraw(state, { type: 'confirm' });
    }
    state = reduceDraw(state, { type: 'enter-reveal', spread: s });
    expect(state.revealedCount).toBe(0);
    expect(reduceDraw(state, { type: 'return-draw' }).phase).toBe('draw');
    const cards = state.drawnCards;
    state = reduceDraw(state, { type: 'reveal-next' });
    expect(reduceDraw(state, { type: 'undo', slot: 0 })).toBe(state);
    expect(reduceDraw(state, { type: 'return-draw' })).toBe(state);
    state = reduceDraw(state, { type: 'reveal-all' });
    expect(state.revealedCount).toBe(s.positions.length);
    expect(state.drawnCards).toBe(cards);
  });

  it('离开洗牌后旧完成事件无效，不完整的牌不能解读', () => {
    const state = ready();
    const edited = reduceDraw(state, { type: 'reset', phase: 'question' });
    expect(reduceDraw(edited, { type: 'shuffled', round: state.round })).toBe(edited);
    expect(reduceDraw(state, { type: 'interpret' })).toBe(state);
    expect(reduceDraw(state, { type: 'preview', index: -1 })).toBe(state);
    expect(reduceDraw(state, { type: 'preview', index: 0.5 })).toBe(state);
  });
});
