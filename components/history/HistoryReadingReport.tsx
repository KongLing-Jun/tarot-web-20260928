'use client';

import Link from 'next/link';
import type { DrawnCard, Reading } from '@/lib/tarot/types';
import { ReadingReport } from '../reading/ReadingReport';
import { InterpretationBody } from '../reading/Interpretation';
import { TarotCardComponent } from '../cards/TarotCard';
import { CelticCrossLayout } from '../cards/CelticCrossLayout';
import report from '../reading/ReadingReport.module.css';
import styles from './HistoryReadingReport.module.css';

const noop = () => {};

export function HistoryReadingReport({
  reading,
  onDelete,
  error,
}: {
  reading: Reading;
  onDelete: () => void;
  error?: string;
}) {
  const cardTerms = reading.drawnCards.flatMap((d) => [d.card.nameCn, d.card.name]);
  const positionTerms = reading.spread.positions.map((p) => p.nameCn);
  const resumeHref = `/agent?readingId=${encodeURIComponent(reading.id)}`;
  const stamp = reading.createdAt.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return (
    <div className={report.page}>
      <header className={report.header}>
        <Link
          data-small-action="icon"
          data-small-icon="back"
          href="/history"
          className={styles.back}
          aria-label="返回轨迹"
        >
          <span aria-hidden="true">〈</span>轨迹
        </Link>
        <button data-small-action="text" type="button" className={styles.delete} onClick={onDelete}>
          删除记录
        </button>
      </header>
      <main id="main-content" className={`${report.main} ${styles.main}`}>
        <div className={report.messages}>
          {error && (
            <p role="alert" className={report.errorNote}>
              {error}
            </p>
          )}
          <div className={styles.caption}>
            <span>解读回顾</span>
            <time dateTime={reading.createdAt.toISOString()}>{stamp}</time>
          </div>
          <h1 className={`${report.question} ${styles.question}`}>
            <span aria-hidden="true">✦</span>
            {reading.question || '未记录问题'}
          </h1>
          <details className={report.spread}>
            <summary>
              <span>
                {reading.spread.nameCn}
                <small> · {reading.drawnCards.length} 张 · 查看牌阵 ⌄</small>
              </span>
              <span className={report.thumbs} aria-hidden="true">
                {reading.drawnCards.slice(0, 3).map((d, i) => (
                  <span key={d.position.id}>{['☀', '☾', '✧'][i]}</span>
                ))}
              </span>
            </summary>
            <div className={report.spreadBody}>
              <p>{reading.spread.description}</p>
              {reading.spread.id === 'celtic-cross' ? (
                <CelticCrossLayout
                  drawnCards={reading.drawnCards}
                  revealedCount={reading.drawnCards.length}
                  onReveal={noop}
                />
              ) : (
                <SavedCards cards={reading.drawnCards} />
              )}
            </div>
          </details>
          {reading.interpretation?.trim() ? (
            <ReadingReport
              key={reading.id}
              content={reading.interpretation}
              running={false}
              error={null}
              hasCards={reading.drawnCards.length > 0}
              cardTerms={cardTerms}
              positionTerms={positionTerms}
              onDetailInteraction={noop}
            />
          ) : (
            <section className={report.readingCard}>
              <h2>尚未保存解读</h2>
              <p className={report.pending}>本次牌面已保留，可以继续聊这件事。</p>
            </section>
          )}
          {!!reading.followUps?.length && (
            <section className={styles.followUps} aria-label="历史追问">
              <h2>
                历史追问 <span>{reading.followUps.length} 次</span>
              </h2>
              {reading.followUps.map((fu, index) => (
                <details key={fu.id} className={styles.followUp}>
                  <summary>
                    <span className={styles.number}>{String(index + 1).padStart(2, '0')}</span>
                    <span>{fu.question}</span>
                    <span aria-hidden="true">⌄</span>
                  </summary>
                  <div className={styles.followUpBody}>
                    {fu.reason && <p className={styles.reason}>{fu.reason}</p>}
                    {fu.additionalCards.length > 0 && (
                      <div className={styles.supplement}>
                        <h3>补充牌 · {fu.additionalCards.length} 张</h3>
                        <SavedCards cards={fu.additionalCards} />
                      </div>
                    )}
                    {fu.interpretation ? (
                      <div className={report.prose}>
                        <InterpretationBody
                          content={fu.interpretation}
                          cardTerms={[
                            ...cardTerms,
                            ...fu.additionalCards.flatMap((d) => [d.card.nameCn, d.card.name]),
                          ]}
                          positionTerms={[
                            ...positionTerms,
                            ...fu.additionalCards.map((d) => d.position.nameCn),
                          ]}
                        />
                      </div>
                    ) : (
                      <p className={report.pending}>这次追问尚未保存解读，可继续聊这件事。</p>
                    )}
                    {fu.error && <p className={report.errorNote}>{fu.error}</p>}
                  </div>
                </details>
              ))}
            </section>
          )}
        </div>
      </main>
      <footer className={styles.footer}>
        <Link data-small-action="text" href={resumeHref}>
          继续聊这件事 <span aria-hidden="true">→</span>
        </Link>
      </footer>
    </div>
  );
}

function SavedCards({ cards }: { cards: DrawnCard[] }) {
  return (
    <div className={report.cards}>
      {cards.map((drawn, index) => (
        <div key={`${drawn.position.id}-${index}`} className={styles.savedCard}>
          <p>{drawn.position.nameCn}</p>
          <TarotCardComponent
            card={drawn.card}
            isReversed={drawn.isReversed}
            isRevealed
            size="sm"
            enableInteractions={false}
          />
          <p>
            {drawn.card.nameCn}
            <small>{drawn.isReversed ? '逆位' : '正位'}</small>
          </p>
        </div>
      ))}
    </div>
  );
}
