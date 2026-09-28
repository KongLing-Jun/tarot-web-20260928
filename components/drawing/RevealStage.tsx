'use client';

import { useLayoutEffect, useRef } from 'react';
import type { DrawnCard, Spread } from '@/lib/tarot/types';
import { RitualHeader } from './RitualScene';
import { TarotCardComponent } from '../cards/TarotCard';
import { CelticCrossLayout } from '../cards/CelticCrossLayout';
import styles from './RevealStage.module.css';
import { RitualMoreMenu } from './RitualMoreMenu';

interface RevealStageProps {
  question: string;
  spread: Spread;
  drawnCards: DrawnCard[];
  revealedCount: number;
  canUseApi: boolean;
  isLoaded: boolean;
  isInterpreting: boolean;
  onNext: () => void;
  onAll: () => void;
  onReturn: () => void;
  onRedraw: () => void;
  onInterpret: () => void;
}

export function RevealStage({
  question,
  spread,
  drawnCards,
  revealedCount,
  canUseApi,
  isLoaded,
  isInterpreting,
  onNext,
  onAll,
  onReturn,
  onRedraw,
  onInterpret,
}: RevealStageProps) {
  const complete = drawnCards.length > 0 && revealedCount === drawnCards.length;
  const next = drawnCards[revealedCount];
  const cross = spread.id === 'celtic-cross';
  const root = useRef<HTMLElement>(null);
  const locked = useRef(false);
  useLayoutEffect(() => {
    locked.current = false;
  }, [revealedCount]);
  const primary = useRef<HTMLButtonElement>(null);
  const transferFocus = useRef(false);
  const reveal = (action: () => void) => {
    if (locked.current) return;
    locked.current = true;
    transferFocus.current = !!root.current?.contains(document.activeElement);
    action();
  };
  const revealCard = (index: number) => {
    if (index !== revealedCount || complete || locked.current) return;
    reveal(onNext);
  };
  useLayoutEffect(() => {
    if (complete && transferFocus.current) {
      if (primary.current && !primary.current.disabled)
        primary.current.focus({ preventScroll: true });
      else root.current?.focus({ preventScroll: true });
      transferFocus.current = false;
    }
  }, [complete]);

  return (
    <section
      ref={root}
      tabIndex={-1}
      aria-label="揭牌"
      className={`${styles.stage} ${cross ? styles.compact : ''}`}
    >
      <RitualMoreMenu
        label="揭牌"
        actions={
          complete
            ? [{ label: '重新抽牌', icon: 'arrows-shuffle', onSelect: onRedraw }]
            : [
                { label: '全部揭牌', icon: 'cards', onSelect: () => reveal(onAll) },
                ...(revealedCount === 0
                  ? [{ label: '返回调整', icon: 'arrow-back-up' as const, onSelect: onReturn }]
                  : []),
              ]
        }
      />
      <div className={styles.header}>
        <RitualHeader
          title={complete ? '牌面皆现' : '逐张揭牌'}
          question={question}
          spreadName={spread.nameCn}
          count={drawnCards.length}
        />
      </div>
      <div className={styles.progress} role="status" aria-live="polite" aria-atomic="true">
        <span>
          已揭 {revealedCount} / {drawnCards.length}
        </span>
        <span>{next ? `下一张 · ${next.position.nameCn}` : '全部揭开'}</span>
      </div>
      <div className={styles.table}>
        {cross ? (
          <CelticCrossLayout
            drawnCards={drawnCards}
            revealedCount={revealedCount}
            appearance="ritual"
            onReveal={revealCard}
          />
        ) : (
          <div className={`${styles.cards} ${drawnCards.length === 3 ? styles.arc : ''}`}>
            {drawnCards.map((drawn, index) => {
              const shown = index < revealedCount;
              const isNext = index === revealedCount;
              return (
                <div key={drawn.position.id} className={styles.position}>
                  <p className={styles.positionName}>{drawn.position.nameCn}</p>
                  <div data-reveal-card data-reveal-next={isNext} className={styles.cardFrame}>
                    <TarotCardComponent
                      card={drawn.card}
                      isReversed={drawn.isReversed}
                      isRevealed={shown}
                      appearance="ritual"
                      enableInteractions={false}
                      className={styles.card}
                      onClick={() => revealCard(index)}
                      disabled={!isNext}
                      ariaLabel={
                        shown
                          ? `${drawn.position.nameCn}，${drawn.card.nameCn}，${drawn.isReversed ? '逆位' : '正位'}`
                          : `${drawn.position.nameCn}，${isNext ? '点击揭牌' : '尚未揭牌'}`
                      }
                    />
                  </div>
                  <div className={styles.identity} aria-hidden={!shown}>
                    {shown && (
                      <>
                        <p>{drawn.card.nameCn}</p>
                        <p>{drawn.isReversed ? '逆位' : '正位'}</p>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div className={styles.dock}>
        <p className={styles.hint} aria-live="polite">
          {next
            ? `轻点「${next.position.nameCn}」，揭开这张牌`
            : '牌已全部揭开，准备好后开始解读。'}
        </p>
        {complete ? (
          <button
            ref={primary}
            type="button"
            className={styles.primary}
            onClick={(event) => {
              if (event.detail < 2) onInterpret();
            }}
            onKeyDown={(event) => {
              if (event.repeat) event.preventDefault();
            }}
            disabled={isInterpreting || !canUseApi}
          >
            {isInterpreting ? '正在生成解读' : '解读这些牌'}
          </button>
        ) : (
          <p className={styles.gestureHint}>点击一次即可翻开</p>
        )}
        {!canUseApi && (
          <p className={styles.service} role="status">
            {isLoaded ? 'AI 服务暂不可用，已抽出的牌会保留。' : '正在检查 AI 服务…'}
          </p>
        )}
      </div>
    </section>
  );
}
