'use client';

import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { Spread } from '@/lib/tarot/types';
import { FanDeck, type CardSource } from '../cards/FanDeck';
import { CompactCardBack } from '../cards/CompactCardBack';
import { FAN } from '../cards/fan-geometry';
import { RitualDock } from './RitualScene';
import ritual from './RitualScene.module.css';
import styles from './ManualDrawTable.module.css';
import { RitualMoreMenu } from './RitualMoreMenu';

interface ManualDrawTableProps {
  spread: Spread;
  deckSize: number;
  slots: (number | null)[];
  previewIndex: number | null;
  onPreview: (index: number | null) => void;
  onConfirm: () => void;
  onUndo: (slot: number) => void;
  onReveal: () => void;
  onEdit: (target: 'question' | 'spread') => void;
  onReshuffle: () => void;
}

export function ManualDrawTable({
  spread,
  deckSize,
  slots,
  previewIndex,
  onPreview,
  onConfirm,
  onUndo,
  onReveal,
  onEdit,
  onReshuffle,
}: ManualDrawTableProps) {
  const locked = useRef(false);
  const table = useRef<HTMLDivElement>(null);
  const destination = useRef<HTMLSpanElement>(null);
  const [flight, setFlight] = useState<CardSource | null>(null);
  const nextSlot = slots.indexOf(null);
  const count = slots.filter((index) => index !== null).length;
  const lastSlot = slots.reduce<number>((last, index, slot) => (index === null ? last : slot), -1);

  // Unlock only after the parent has committed the new selection.
  useLayoutEffect(() => {
    locked.current = false;
  }, [slots]);

  const extract = (source?: CardSource) => {
    if (locked.current || previewIndex === null || nextSlot < 0 || slots.includes(previewIndex))
      return;
    locked.current = true;
    if (source) setFlight(source);
    else onConfirm();
  };
  const idle = (action: () => void) => {
    if (!locked.current) action();
  };

  return (
    <div ref={table} className={styles.table} aria-busy={Boolean(flight)}>
      <RitualMoreMenu
        label="抽牌"
        actions={[
          {
            label: '撤回上一张',
            icon: 'arrow-back-up',
            disabled: Boolean(flight) || lastSlot < 0,
            onSelect: () => idle(() => onUndo(lastSlot)),
          },
          {
            label: '修改问题',
            icon: 'feather',
            disabled: Boolean(flight),
            onSelect: () => idle(() => onEdit('question')),
          },
          {
            label: '修改牌阵',
            icon: 'cards',
            disabled: Boolean(flight),
            onSelect: () => idle(() => onEdit('spread')),
          },
          {
            label: '重新洗牌',
            icon: 'arrows-shuffle',
            disabled: Boolean(flight),
            onSelect: () => idle(onReshuffle),
          },
        ]}
      />
      <div className={styles.progress} role="status" aria-live="polite">
        <span ref={destination} className={styles.collected}>
          <span>
            已抽 {count} / {slots.length}
          </span>
          {count > 0 && (
            <span className={styles.cardMarks} aria-hidden="true">
              {slots.map(
                (index, slot) =>
                  index !== null && <span key={`${slot}-${index}`} className={styles.cardMark} />,
              )}
            </span>
          )}
        </span>
        <span>
          {nextSlot >= 0
            ? `下一张 · ${spread.positions[nextSlot].nameCn}`
            : '已选齐，揭牌前仍可撤回'}
        </span>
      </div>
      <FanDeck
        deckSize={deckSize}
        selectedIndices={slots.filter((index): index is number => index !== null)}
        previewIndex={previewIndex}
        disabled={Boolean(flight) || nextSlot < 0}
        extracting={Boolean(flight)}
        onPreview={(index) => idle(() => onPreview(index))}
        onExtract={(index, source) => {
          if (index === previewIndex) extract(source);
        }}
      />
      {flight &&
        createPortal(
          <ExtractionFlight
            source={flight}
            table={table}
            destination={destination}
            label={spread.positions[nextSlot].nameCn}
            onComplete={() => {
              setFlight(null);
              onConfirm();
            }}
          />,
          document.body,
        )}
      {nextSlot < 0 && (
        <RitualDock>
          <p>选牌完成，准备揭开这些牌</p>
          <button className={ritual.primary} onClick={() => idle(onReveal)}>
            返回揭牌
          </button>
        </RitualDock>
      )}
    </div>
  );
}

function ExtractionFlight({
  source,
  table,
  destination,
  label,
  onComplete,
}: {
  source: CardSource;
  table: RefObject<HTMLElement | null>;
  destination: RefObject<HTMLElement | null>;
  label: string;
  onComplete: () => void;
}) {
  const card = useRef<HTMLDivElement>(null);
  const complete = useRef(onComplete);
  useLayoutEffect(() => {
    complete.current = onComplete;
  }, [onComplete]);
  useLayoutEffect(() => {
    const element = card.current!;
    // Older web-views still commit the draw if Web Animations is unavailable.
    if (!element.animate || !table.current || !destination.current) {
      complete.current();
      return;
    }
    const bounds = table.current.getBoundingClientRect();
    const target = destination.current.getBoundingClientRect();
    const face = element.getBoundingClientRect();
    const theme = getComputedStyle(element);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // CSS optimization may normalize 950ms to .95s; Web Animations expects milliseconds.
    const time = theme.getPropertyValue(reduced ? '--dur-quick' : '--dur-veil').trim();
    const duration = parseFloat(time) * (time.endsWith('ms') ? 1 : 1000);
    if (!face.width || !face.height || !Number.isFinite(duration)) {
      complete.current();
      return;
    }
    const center = `translate(${bounds.left + bounds.width / 2 - face.width / 2}px, ${bounds.top + bounds.height / 2 - face.height / 2}px)`;
    const animation = element.animate(
      reduced
        ? [
            { transform: center, opacity: 0 },
            { transform: center, opacity: 1, offset: 0.5 },
            { transform: center, opacity: 0 },
          ]
        : [
            {
              transform: `translate(${source.x - face.width / 2}px, ${source.y - face.height / 2}px) rotate(${source.angle}deg) scale(${source.width / face.width}, ${source.height / face.height})`,
              opacity: 1,
            },
            { transform: `${center} rotate(-3deg) scale(1.04)`, opacity: 1, offset: 0.4 },
            { transform: `${center} rotate(0deg) scale(1)`, opacity: 1, offset: 0.7 },
            {
              transform: `translate(${target.left + target.width / 2 - face.width / 2}px, ${target.top + target.height / 2 - face.height / 2}px) scale(0.16)`,
              opacity: 0,
            },
          ],
      { duration, easing: theme.getPropertyValue('--ease-ritual').trim(), fill: 'both' },
    );
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      complete.current();
    };
    // Backgrounding or cancellation must not leave a selected card permanently locked.
    const hidden = () => {
      if (document.hidden) finish();
    };
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('resize', finish);
    animation.finished.then(finish, finish);
    return () => {
      finished = true;
      animation.cancel();
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('resize', finish);
    };
  }, [source, table, destination]);
  return (
    <div aria-hidden="true" className={styles.flight}>
      <div
        ref={card}
        data-draw-flight
        className={styles.flightCard}
        style={{ aspectRatio: `${FAN.cardWidth} / ${FAN.cardHeight}` }}
      >
        <CompactCardBack appearance="ritual" />
        <span className={styles.flightLabel}>{label}</span>
      </div>
    </div>
  );
}
