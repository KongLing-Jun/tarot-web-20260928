import type { DeckCard } from './draw';
import type { DrawnCard, Spread } from './types';

export type ReadingPhase = 'question' | 'spread' | 'shuffle' | 'draw' | 'reveal' | 'interpret';
export interface ManualDrawState {
  phase: ReadingPhase;
  shuffleStatus: 'idle' | 'shuffling' | 'ready';
  round: number;
  deck: DeckCard[];
  slots: (number | null)[];
  previewIndex: number | null;
  drawnCards: DrawnCard[];
  revealedCount: number;
}
export const initialDrawState: ManualDrawState = {
  phase: 'question',
  shuffleStatus: 'idle',
  round: 0,
  deck: [],
  slots: [],
  previewIndex: null,
  drawnCards: [],
  revealedCount: 0,
};
export type DrawAction =
  | { type: 'navigate' | 'reset'; phase: 'question' | 'spread' | 'shuffle' }
  | { type: 'shuffle'; deck: DeckCard[]; count: number }
  | { type: 'shuffled'; round: number }
  | { type: 'preview'; index: number | null }
  | { type: 'undo'; slot: number }
  | { type: 'enter-reveal'; spread: Spread }
  | { type: 'start-draw' | 'confirm' | 'return-draw' | 'reveal-next' | 'reveal-all' | 'interpret' };

const isComplete = (s: ManualDrawState) => s.slots.length > 0 && s.slots.every((i) => i !== null);

export function reduceDraw(s: ManualDrawState, action: DrawAction): ManualDrawState {
  switch (action.type) {
    case 'reset':
      return { ...initialDrawState, phase: action.phase, round: s.round + 1 };
    case 'navigate':
      if (!['question', 'spread'].includes(s.phase)) return s;
      return { ...initialDrawState, phase: action.phase, round: s.round + 1 };
    case 'shuffle':
      if (s.phase !== 'shuffle' || s.shuffleStatus === 'shuffling') return s;
      return {
        ...initialDrawState,
        phase: 'shuffle',
        shuffleStatus: 'shuffling',
        round: s.round + 1,
        deck: action.deck,
        slots: Array(action.count).fill(null),
      };
    case 'shuffled':
      if (s.phase !== 'shuffle' || s.shuffleStatus !== 'shuffling' || action.round !== s.round)
        return s;
      return { ...s, shuffleStatus: 'ready' };
    case 'start-draw':
      return s.phase === 'shuffle' && s.shuffleStatus === 'ready' ? { ...s, phase: 'draw' } : s;
    case 'preview':
      if (s.phase !== 'draw') return s;
      if (action.index === null) return s.previewIndex === null ? s : { ...s, previewIndex: null };
      if (
        isComplete(s) ||
        !Number.isInteger(action.index) ||
        !s.deck[action.index] ||
        s.slots.includes(action.index)
      )
        return s;
      return { ...s, previewIndex: action.index };
    case 'confirm': {
      if (s.phase !== 'draw' || s.previewIndex === null || s.slots.includes(s.previewIndex))
        return s;
      const slot = s.slots.indexOf(null);
      if (slot < 0) return s;
      return {
        ...s,
        slots: s.slots.map((i, n) => (n === slot ? s.previewIndex : i)),
        previewIndex: null,
        drawnCards: [],
      };
    }
    case 'undo':
      if (
        s.phase !== 'draw' ||
        s.revealedCount ||
        !Number.isInteger(action.slot) ||
        s.slots[action.slot] == null
      )
        return s;
      return {
        ...s,
        slots: s.slots.map((i, n) => (n === action.slot ? null : i)),
        previewIndex: null,
        drawnCards: [],
      };
    case 'enter-reveal':
      if (s.phase !== 'draw' || !isComplete(s) || s.slots.length !== action.spread.positions.length)
        return s;
      return {
        ...s,
        phase: 'reveal',
        previewIndex: null,
        drawnCards: s.slots.map((i, n) => ({
          card: s.deck[i!].card,
          isReversed: s.deck[i!].isReversed,
          position: action.spread.positions[n],
        })),
      };
    case 'return-draw':
      return s.phase === 'reveal' && !s.revealedCount ? { ...s, phase: 'draw' } : s;
    case 'reveal-next':
    case 'reveal-all':
      if (s.phase !== 'reveal' || !isComplete(s) || s.revealedCount >= s.drawnCards.length)
        return s;
      return {
        ...s,
        revealedCount: action.type === 'reveal-all' ? s.drawnCards.length : s.revealedCount + 1,
      };
    case 'interpret':
      if (
        !['reveal', 'interpret'].includes(s.phase) ||
        !s.drawnCards.length ||
        s.revealedCount !== s.drawnCards.length
      )
        return s;
      return { ...s, phase: 'interpret' };
  }
}
