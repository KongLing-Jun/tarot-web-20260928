'use client';

import { useEffect, type CSSProperties, type ReactNode } from 'react';
import { CardBack } from '../cards/CardBack';
import { RitualDock, RitualIcon } from './RitualScene';
import ritual from './RitualScene.module.css';
import styles from './CardDeck.module.css';

// Leave time to read the split, interleave and square-up before enabling the draw action.
const SHUFFLE_DURATION_MS = 2400;
interface CardDeckProps {
  status: 'idle' | 'shuffling' | 'ready';
  round: number;
  onStart: () => void;
  onFinish: (round: number) => void;
  onDraw: () => void;
  children?: ReactNode;
}

export function CardDeck({ status, round, onStart, onFinish, onDraw, children }: CardDeckProps) {
  useEffect(() => {
    if (status !== 'shuffling') return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      onFinish(round);
      return;
    }
    const timer = window.setTimeout(() => onFinish(round), SHUFFLE_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [status, round, onFinish]);

  return (
    <div className={styles.deck} data-shuffle-state={status}>
      <div
        className={`${styles.stage} ${status === 'shuffling' ? styles.shuffling : ''}`}
        style={{ '--shuffle-duration': `${SHUFFLE_DURATION_MS}ms` } as CSSProperties}
      >
        <div className={styles.orbit} aria-hidden />
        <button
          type="button"
          className={styles.stack}
          aria-label="点击牌堆洗牌"
          disabled={status === 'shuffling'}
          onClick={onStart}
        >
          {Array.from({ length: 8 }, (_, i) => (
            <span
              key={i}
              className={styles.card}
              aria-hidden
              style={
                {
                  '--layer': Math.floor(i / 2),
                  '--direction': i % 2 ? 1 : -1,
                  '--index': i,
                  zIndex: 8 - i,
                } as CSSProperties
              }
            >
              <CardBack compact animated={false} appearance="ritual" />
            </span>
          ))}
        </button>
      </div>
      <p className={styles.caption}>
        {status === 'shuffling'
          ? '洗牌时，于心中默念你的问题'
          : status === 'ready'
            ? '轻点牌堆，可再洗一次'
            : '轻点牌堆，即可洗牌'}
      </p>
      {children}
      <RitualDock>
        <p role="status" aria-live="polite">
          {status === 'ready'
            ? '牌已洗好，准备好后开始抽牌。'
            : status === 'shuffling'
              ? '正在洗牌，请稍候。'
              : '直接开始抽牌，将先为你洗一次牌。'}
        </p>
        <button
          className={`${ritual.primary} ${styles.primary}`}
          disabled={status === 'shuffling'}
          onClick={onDraw}
        >
          开始抽牌
          <RitualIcon name="chevron-right" />
        </button>
      </RitualDock>
    </div>
  );
}
