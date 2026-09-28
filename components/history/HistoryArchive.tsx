'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState, type CSSProperties } from 'react';
import type { Reading } from '@/lib/tarot/types';
import { CardBack } from '../cards/CardBack';
import { RitualIcon } from '../drawing/RitualScene';
import styles from './HistoryArchive.module.css';

interface HistoryArchiveProps {
  readings: Reading[];
  isSelectionMode: boolean;
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
}

function stamp(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}　${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function HistoryArchive({
  readings,
  isSelectionMode,
  selectedIds,
  onToggle,
}: HistoryArchiveProps) {
  // The month heading follows each record's actual date, including after deletion.
  const groups = new Map<string, { label: string; readings: Reading[] }>();
  for (const reading of [...readings].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  )) {
    const date = reading.createdAt;
    const key = `${date.getFullYear()}-${date.getMonth()}`;
    if (!groups.has(key))
      groups.set(key, { label: `${date.getFullYear()}年${date.getMonth() + 1}月`, readings: [] });
    groups.get(key)!.readings.push(reading);
  }
  return (
    <div className={styles.archive}>
      {[...groups].map(([key, group], index) => (
        <section key={key} aria-label={group.label}>
          <div className={styles.month}>
            <h2>
              <RitualIcon name="compass" />
              {group.label}
            </h2>
            <span className={styles.monthRule} aria-hidden="true" />
            <span className={styles.count}>
              {index === 0 ? `共 ${readings.length} 次解读` : `${group.readings.length} 次解读`}
            </span>
          </div>
          {group.readings.map((reading) => (
            <HistoryEntry
              key={reading.id}
              reading={reading}
              isSelectionMode={isSelectionMode}
              isSelected={selectedIds.has(reading.id)}
              onToggle={onToggle}
            />
          ))}
        </section>
      ))}
      <p className={styles.end}>轨迹至此</p>
    </div>
  );
}

function HistoryEntry({
  reading,
  isSelectionMode,
  isSelected,
  onToggle,
}: {
  reading: Reading;
  isSelectionMode: boolean;
  isSelected: boolean;
  onToggle: (id: string) => void;
}) {
  const question = reading.question || '未记录问题';
  const detailHref = `/history/${encodeURIComponent(reading.id)}`;
  const cards = reading.drawnCards.slice(0, 3);
  return (
    <article className={styles.entry} data-selected={isSelected}>
      <time dateTime={reading.createdAt.toISOString()} className={styles.date}>
        {stamp(reading.createdAt)}
      </time>
      <div className={styles.entryBody}>
        <div className={styles.cards} aria-hidden="true">
          {cards.map((drawn, index) => (
            <div
              key={`${drawn.position.id}-${index}`}
              className={styles.card}
              style={
                {
                  '--card-offset': index - (cards.length - 1) / 2,
                  zIndex: index === 1 ? 2 : 1,
                } as CSSProperties
              }
            >
              <HistoryThumbnail
                key={drawn.card.image}
                src={drawn.card.image}
                isReversed={drawn.isReversed}
              />
            </div>
          ))}
        </div>
        <div className={styles.entryText}>
          <h3>{isSelectionMode ? question : <Link href={detailHref}>{question}</Link>}</h3>
          <p className={styles.meta}>
            {reading.spread.nameCn}
            <span> · </span>
            {reading.drawnCards.length}张
            {!!reading.followUps?.length && (
              <>
                <span> · </span>
                {reading.followUps.length}次追问
              </>
            )}
          </p>
          {!isSelectionMode && (
            <div className={styles.entryActions}>
              <Link data-small-action="text" href={detailHref} aria-label={`回看解读：${question}`}>
                回看解读 <span aria-hidden="true">→</span>
              </Link>
              <Link
                data-small-action="text"
                href={`/agent?readingId=${encodeURIComponent(reading.id)}`}
                aria-label={`继续聊：${question}`}
              >
                继续聊
              </Link>
            </div>
          )}
          {isSelectionMode && (
            <span className={styles.selectionHint}>
              {isSelected ? '已选择' : '点击选择这条记录'}
            </span>
          )}
        </div>
      </div>
      {isSelectionMode && (
        <button
          className={styles.selectEntry}
          type="button"
          aria-label={`选择记录：${question}`}
          aria-pressed={isSelected}
          onClick={() => onToggle(reading.id)}
        >
          <span aria-hidden="true">{isSelected ? '✓' : ''}</span>
        </button>
      )}
    </article>
  );
}

function HistoryThumbnail({ src, isReversed }: { src: string; isReversed: boolean }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <CardBack appearance="ritual" />;
  // Card URLs redirect to storage; use the same direct loading path as TarotCard.
  return (
    <Image
      unoptimized
      src={src}
      alt=""
      width={60}
      height={100}
      sizes="60px"
      className={isReversed ? styles.reversed : undefined}
      onError={() => setFailed(true)}
    />
  );
}
