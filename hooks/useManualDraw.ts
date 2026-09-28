'use client';

import { useCallback, useRef, useState } from 'react';
import { createShuffledDeck } from '@/lib/tarot/draw';
import { initialDrawState, reduceDraw, type DrawAction } from '@/lib/tarot/manual-draw';
import type { Spread } from '@/lib/tarot/types';

export function useManualDraw(spread: Spread) {
  const [state, setState] = useState(initialDrawState);
  const current = useRef(state);
  const drawAfterRound = useRef<number | null>(null);
  // Synchronous guards also protect multiple actions before React's next render.
  const dispatch = useCallback((action: DrawAction) => {
    const next = reduceDraw(current.current, action);
    current.current = next;
    setState(next);
    return next;
  }, []);
  const startShuffle = useCallback(() => {
    if (current.current.phase !== 'shuffle' || current.current.shuffleStatus === 'shuffling')
      return;
    drawAfterRound.current = null;
    return dispatch({ type: 'shuffle', deck: createShuffledDeck(), count: spread.positions.length })
      .round;
  }, [dispatch, spread]);
  const finishShuffle = useCallback(
    (round: number) => {
      const next = dispatch({ type: 'shuffled', round });
      // Only the requested round may continue into drawing; resets invalidate older callbacks.
      if (
        drawAfterRound.current === round &&
        next.round === round &&
        next.phase === 'shuffle' &&
        next.shuffleStatus === 'ready'
      ) {
        drawAfterRound.current = null;
        dispatch({ type: 'start-draw' });
      }
    },
    [dispatch],
  );
  const startDraw = useCallback(() => {
    if (current.current.phase !== 'shuffle') return;
    if (current.current.shuffleStatus === 'idle') {
      drawAfterRound.current = startShuffle() ?? null;
    } else {
      dispatch({ type: 'start-draw' });
    }
  }, [dispatch, startShuffle]);
  return { ...state, dispatch, startShuffle, finishShuffle, startDraw };
}
