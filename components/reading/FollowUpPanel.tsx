'use client';

import { useMemo } from 'react';
import type { FollowUp, ApiConfig } from '@/lib/tarot/types';
import { TarotCardComponent } from '../cards/TarotCard';
import { ReadingReport } from './ReadingReport';
import type { RetryState } from '@/lib/api/stream-client';
import styles from './ReadingReport.module.css';
import manual from './ManualReadingReport.module.css';

interface FollowUpPanelProps {
  followUp: FollowUp;
  apiConfig: ApiConfig;
  baseCardTerms?: string[];
  basePositionTerms?: string[];
  retry?: RetryState | null;
  onRevealNext: (id: string, config: ApiConfig) => void;
  onRevealAll: (id: string, config: ApiConfig) => void;
  onRetry: (id: string, config: ApiConfig) => void;
  onDetailInteraction: () => void;
}

export function FollowUpPanel({
  followUp,
  apiConfig,
  baseCardTerms,
  basePositionTerms,
  retry,
  onRevealNext,
  onRevealAll,
  onRetry,
  onDetailInteraction,
}: FollowUpPanelProps) {
  const { status, decision, reason, additionalCards, revealedCount, interpretation, error } =
    followUp;
  const cardTerms = useMemo(
    () => [
      ...(baseCardTerms ?? []),
      ...additionalCards.flatMap((d) => [d.card.nameCn, d.card.name]),
    ],
    [baseCardTerms, additionalCards],
  );
  const positionTerms = useMemo(
    () => [...(basePositionTerms ?? []), ...additionalCards.map((d) => d.position.nameCn)],
    [basePositionTerms, additionalCards],
  );
  return (
    <section className={manual.followUp} aria-label="本次追问">
      <p className={styles.question}>
        <span aria-hidden="true">✦</span>继续聊 · {followUp.question}
      </p>
      {status === 'deciding' && (
        <p role="status" className={styles.pending}>
          正在判断是否需要补牌{retry ? `（重试 ${retry.attempt} / ${retry.max}）` : '…'}
        </p>
      )}
      {decision === 'draw' && (
        <div className={manual.supplement}>
          <h3>本次追问需要 {additionalCards.length} 张补牌</h3>
          {reason && <p>{reason}</p>}
          <div className={styles.cards}>
            {additionalCards.map((drawn, index) => (
              <div key={drawn.position.id}>
                <p className={manual.position}>{drawn.position.nameCn}</p>
                <TarotCardComponent
                  card={drawn.card}
                  isReversed={drawn.isReversed}
                  isRevealed={index < revealedCount}
                  onClick={() => {
                    if (status === 'awaiting-reveal' && index === revealedCount)
                      onRevealNext(followUp.id, apiConfig);
                  }}
                  size="sm"
                />
              </div>
            ))}
          </div>
          {status === 'awaiting-reveal' && revealedCount < additionalCards.length && (
            <div className={styles.reportActions}>
              <button
                data-small-action="text"
                type="button"
                onClick={() => onRevealAll(followUp.id, apiConfig)}
              >
                全部揭牌
              </button>
            </div>
          )}
        </div>
      )}
      {(interpretation || status === 'interpreting' || status === 'error') && (
        <ReadingReport
          content={interpretation}
          running={status === 'interpreting'}
          error={status === 'error' ? (error ?? '追问失败') : null}
          notice={followUp.notice ?? (status === 'done' ? error : null)}
          retry={retry}
          hasCards={true}
          cardTerms={cardTerms}
          positionTerms={positionTerms}
          onDetailInteraction={onDetailInteraction}
        />
      )}
      {(status === 'error' || followUp.persistenceStatus === 'failed') && (
        <div className={styles.reportActions}>
          <button
            data-small-action="text"
            type="button"
            onClick={() => onRetry(followUp.id, apiConfig)}
          >
            {followUp.persistenceStatus === 'failed' && followUp.generationStatus === 'completed'
              ? '重试保存'
              : decision
                ? '重试解读（保留原牌）'
                : '重试补牌判断'}
          </button>
        </div>
      )}
    </section>
  );
}
