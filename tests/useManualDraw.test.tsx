import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { useManualDraw } from '@/hooks/useManualDraw';
import { getDefaultSpread } from '@/lib/tarot/spreads';

afterEach(cleanup);
function setup() {
  const hook = renderHook(() => useManualDraw(getDefaultSpread()));
  act(() => {
    hook.result.current.dispatch({ type: 'navigate', phase: 'shuffle' });
  });
  return hook;
}

it('未洗牌直接开始时只洗一次，当前轮完成后自动进入抽牌', () => {
  const { result } = setup();
  const before = result.current.round;
  act(() => {
    result.current.startDraw();
    result.current.startDraw();
  });
  expect(result.current.round).toBe(before + 1);
  expect(result.current.shuffleStatus).toBe('shuffling');
  expect(result.current.phase).toBe('shuffle');
  expect(result.current.deck).toHaveLength(78);
  expect(result.current.slots).toHaveLength(3);
  act(() => {
    result.current.finishShuffle(before);
  });
  expect(result.current.phase).toBe('shuffle');
  const deck = result.current.deck;
  act(() => {
    result.current.finishShuffle(before + 1);
    result.current.finishShuffle(before + 1);
  });
  expect(result.current.phase).toBe('draw');
  expect(result.current.deck).toBe(deck);
  expect(result.current.round).toBe(before + 1);
});

it('主动洗牌可重复执行，洗好后点击开始不会重新洗牌', () => {
  const { result } = setup();
  for (let i = 0; i < 2; i++) {
    act(() => {
      result.current.startShuffle();
    });
    act(() => {
      result.current.finishShuffle(result.current.round);
    });
    expect(result.current.phase).toBe('shuffle');
    expect(result.current.shuffleStatus).toBe('ready');
  }
  const { round, deck } = result.current;
  act(() => {
    result.current.startDraw();
  });
  expect(result.current.phase).toBe('draw');
  expect(result.current.round).toBe(round);
  expect(result.current.deck).toBe(deck);
});

it('主动洗牌过程中收到开始指令不会改为自动进入', () => {
  const { result } = setup();
  act(() => {
    result.current.startShuffle();
    result.current.startDraw();
  });
  act(() => {
    result.current.finishShuffle(result.current.round);
  });
  expect(result.current.phase).toBe('shuffle');
});

it('修改问题或牌阵后，旧洗牌回调不能自动跳转', () => {
  const { result } = setup();
  act(() => {
    result.current.startDraw();
  });
  const oldRound = result.current.round;
  act(() => {
    result.current.dispatch({ type: 'reset', phase: 'question' });
    result.current.finishShuffle(oldRound);
  });
  expect(result.current.phase).toBe('question');
  act(() => {
    result.current.dispatch({ type: 'navigate', phase: 'shuffle' });
    result.current.startShuffle();
  });
  act(() => {
    result.current.finishShuffle(result.current.round);
  });
  expect(result.current.phase).toBe('shuffle');
  expect(result.current.shuffleStatus).toBe('ready');
});
