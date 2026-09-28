'use client';

import { DrawnCard } from '@/lib/tarot/types';
import { TarotCardComponent } from '@/components/cards/TarotCard';
import { type ComponentProps, useState } from 'react';
import styles from './CelticCrossLayout.module.css';

/**
 * 凯尔特十字牌阵空间布局。
 *
 * 桌面（≥768px）经典布局：
 *   - 左侧十字部分：中央纵牌① + 横置挑战牌② + 上⑤ + 下⑥ + 左③ + 右④
 *   - 右侧柱状部分：从下到上 ⑦⑧⑨⑩
 *
 * 移动端（<768px）紧凑布局：
 *   - 上方 3×3 十字，下方 2×2 牌柱
 *
 * 各牌的 grid 坐标由 globals.css 中的 .celtic-pos-N 按断点定义。
 */

interface CelticCrossLayoutProps {
  drawnCards: DrawnCard[];
  revealedCount: number;
  onReveal: (index: number) => void;
  selectedRevealIndex?: number | null;
  appearance?: ComponentProps<typeof TarotCardComponent>['appearance'];
}

// index 1 = 挑战牌，横置覆盖在中央牌之上
const CHALLENGE_INDEX = 1;

export function CelticCrossLayout({
  drawnCards,
  revealedCount,
  onReveal,
  appearance = 'default',
  selectedRevealIndex,
}: CelticCrossLayoutProps) {
  const twoStep = selectedRevealIndex !== undefined;
  const revealLabel = (index: number) =>
    twoStep ? (selectedRevealIndex === index ? '已选中，再次点击揭牌' : '点击选中') : '点击揭牌';
  const ritual = appearance === 'ritual';
  const [view, setView] = useState<'diagram' | 'positions'>('diagram');
  const [selected, setSelected] = useState<number | null>(null);
  const detail = selected !== null && selected < revealedCount ? drawnCards[selected] : null;
  const selectPosition = (index: number) => {
    if (index > revealedCount) return;
    if (index === revealedCount) onReveal(index);
    if (!twoStep || index < revealedCount) setSelected(index);
  };

  return (
    <div className={`w-full max-w-4xl mx-auto ${ritual ? styles.ritual : ''}`}>
      <div
        className={`flex justify-center gap-4 mb-8 ${ritual ? styles.views : ''}`}
        role="group"
        aria-label="牌阵查看方式"
      >
        <button
          data-small-action="tab"
          className="btn-ink min-h-11"
          aria-pressed={view === 'diagram'}
          onClick={() => setView('diagram')}
        >
          牌阵图
        </button>
        <button
          data-small-action="tab"
          className="btn-ink min-h-11"
          aria-pressed={view === 'positions'}
          onClick={() => setView('positions')}
        >
          按位置查看
        </button>
      </div>
      {view === 'positions' ? (
        <ol className={`grid gap-3 sm:grid-cols-2 ${ritual ? styles.positions : ''}`}>
          {drawnCards.map((drawn, index) => (
            <li key={drawn.position.id}>
              <button
                className="ink-panel-quiet w-full p-4 text-left min-h-11 text-bone"
                onClick={() => selectPosition(index)}
                aria-pressed={
                  twoStep ? index === revealedCount && selectedRevealIndex === index : undefined
                }
                disabled={index > revealedCount}
              >
                <span className="block text-gold">
                  {index + 1}. {drawn.position.nameCn}
                </span>
                <span className="block mt-2">
                  {index < revealedCount
                    ? `${drawn.card.nameCn} · ${drawn.isReversed ? '逆位' : '正位'}`
                    : index === revealedCount
                      ? twoStep
                        ? revealLabel(index)
                        : '点击揭开这张牌'
                      : '尚未揭牌'}
                </span>
                <span className="block text-sm text-bone-dim mt-2">
                  {drawn.position.description}
                </span>
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <div className={`celtic-cross-grid ${ritual ? styles.grid : ''}`}>
          {drawnCards.map((drawn, index) => {
            const isChallenge = index === CHALLENGE_INDEX;
            const isRevealed = index < revealedCount;

            return (
              <div
                key={drawn.position.id}
                className={`celtic-cross-cell celtic-pos-${index} flex flex-col items-center gap-2 ${ritual ? styles.cell : ''} ${ritual && isChallenge ? styles.challenge : ''}`}
                data-reveal-position={index + 1}
                data-reveal-pending={ritual && index > revealedCount}
                style={{ zIndex: isChallenge ? 2 : 1 }}
              >
                {/* 阵位名 · 常驻显示（触屏无 hover）
               挑战牌的标签设为 invisible 占位，保证与同格的中央牌垂直对齐 */}
                <span
                  className={`cn-hint text-bone-faint whitespace-nowrap max-w-[110px] truncate ${
                    isChallenge ? 'invisible' : ''
                  }`}
                >
                  {ritual
                    ? isChallenge
                      ? ''
                      : `${index + 1} ${drawn.position.nameCn}`
                    : drawn.position.nameCn}
                </span>

                <div
                  data-reveal-card
                  data-reveal-selected={
                    twoStep && index === revealedCount && selectedRevealIndex === index
                  }
                  className={`${isChallenge ? 'rotate-90 origin-center' : ''} ${ritual && index === revealedCount && (!twoStep || selectedRevealIndex === index) ? styles.next : ''}`}
                >
                  <TarotCardComponent
                    card={drawn.card}
                    isReversed={drawn.isReversed}
                    isRevealed={isRevealed}
                    onClick={() => selectPosition(index)}
                    disabled={index > revealedCount}
                    ariaPressed={
                      twoStep ? index === revealedCount && selectedRevealIndex === index : undefined
                    }
                    appearance={appearance}
                    ariaLabel={
                      ritual
                        ? `${drawn.position.nameCn}，${isRevealed ? `${drawn.card.nameCn}，${drawn.isReversed ? '逆位' : '正位'}` : index === revealedCount ? revealLabel(index) : '尚未揭牌'}`
                        : undefined
                    }
                    className={ritual ? styles.card : undefined}
                    enableInteractions={!ritual}
                    size="sm"
                  />
                </div>

                {/* 下方说明 · 挑战牌下移一行，避开中央牌的说明 */}
                <span
                  className={`cn-hint text-center whitespace-nowrap max-w-[110px] truncate min-h-4 ${
                    isChallenge ? 'translate-y-5 text-bone-faint' : 'text-bone-whisper'
                  }`}
                >
                  {ritual ? (
                    isChallenge ? (
                      <>
                        <span className="block">
                          {index + 1} {drawn.position.nameCn}
                        </span>
                        {isRevealed && (
                          <span className="block">
                            {drawn.card.nameCn} · {drawn.isReversed ? '逆位' : '正位'}
                          </span>
                        )}
                      </>
                    ) : isRevealed ? (
                      `${drawn.card.nameCn} · ${drawn.isReversed ? '逆位' : '正位'}`
                    ) : (
                      ''
                    )
                  ) : isChallenge ? (
                    isRevealed ? (
                      `${drawn.position.nameCn} · ${drawn.card.nameCn}`
                    ) : (
                      drawn.position.nameCn
                    )
                  ) : isRevealed ? (
                    drawn.card.nameCn
                  ) : (
                    ''
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
      {detail && (
        <section
          className={`ink-panel-quiet p-5 mt-8 text-bone ${ritual ? styles.detail : ''}`}
          aria-label="位置详情"
          aria-live="polite"
        >
          <h3 className="text-gold font-heading">
            {detail.position.nameCn} · {detail.card.nameCn} · {detail.isReversed ? '逆位' : '正位'}
          </h3>
          <p className="text-sm text-bone-dim mt-2">
            {detail.card.name} — {detail.position.description}
          </p>
          <p className="mt-3 leading-relaxed">
            {detail.isReversed ? detail.card.meaning.reversed : detail.card.meaning.upright}
          </p>
        </section>
      )}
    </div>
  );
}
