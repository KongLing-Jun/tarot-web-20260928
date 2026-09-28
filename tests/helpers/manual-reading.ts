import { act } from '@testing-library/react';
import type { useReading } from '@/hooks/useReading';

/** Use the real user transitions before testing interpretation/follow-up behavior. */
export function selectReading(result: { current: ReturnType<typeof useReading> }) {
  act(() => result.current.goToPhase('shuffle'));
  act(() => result.current.startShuffle());
  act(() => result.current.finishShuffle(result.current.shuffleRound));
  act(() => result.current.startDraw());
  for (let i = 0; i < result.current.spread.positions.length; i++) {
    act(() => result.current.previewCard(i));
    act(() => result.current.confirmCard());
  }
  act(() => result.current.revealAllCards());
}
