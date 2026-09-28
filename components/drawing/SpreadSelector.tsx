'use client';

import {
  useId,
  useLayoutEffect,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from 'react';
import { Spread } from '@/lib/tarot/types';
import { spreads } from '@/lib/tarot/spreads';
import { getSpreadGuidance, getSpreadPositionGuidance } from '@/lib/tarot/spread-guidance';
import styles from './SpreadSelector.module.css';

// Visual slots surround the selected card; recycling happens outside the visible stage.
const SLOTS = [-2, -1, 0, 1, 2];
const SWIPE_THRESHOLD = 0.18; // Fraction of the distance between adjacent cards.
const TAP_SLOP = 6; // CSS pixels: distinguish a click from a deliberate drag.

// Keep the traditional central cross; the right-hand staff has room between card edges.
const CELTIC_POSITIONS = [
  [82, 58],
  [82, 58],
  [30, 58],
  [134, 58],
  [82, 16],
  [82, 100],
  [194, 133],
  [194, 94],
  [194, 55],
  [194, 16],
];
// Anchor numbers outside the card edges. The central vertical card uses its upper-left corner.
const CELTIC_LABELS = [
  [71, 36, 'left'],
  [101.25, 58, 'right'],
  [19, 58, 'left'],
  [145, 58, 'right'],
  [71, 16, 'left'],
  [71, 100, 'left'],
  [205, 133, 'right'],
  [205, 94, 'right'],
  [205, 55, 'right'],
  [205, 16, 'right'],
] as const;

export function SpreadDiagram({ spread }: { spread: Spread }) {
  const celtic = spread.id === 'celtic-cross';
  const named = spread.positions.length <= 3;
  const width = named ? 56 : celtic ? 22 : 34;
  const height = (width * 7) / 4;
  const diagramHeight = celtic ? 162 : 128;
  const positions = spread.positions.map((position, index) => {
    const [x, y] = celtic
      ? CELTIC_POSITIONS[index]
      : [120 + (index - (spread.positions.length - 1) / 2) * (named ? 65 : 43), 55];
    const [labelX, labelY, labelSide] = celtic
      ? CELTIC_LABELS[index]
      : [x, y + (named ? 63 : 45), undefined];
    return { position, x, y, labelX, labelY, labelSide };
  });
  return (
    <span
      className={styles.diagramCanvas}
      style={{
        aspectRatio: `240 / ${diagramHeight}`,
        maxWidth: `calc(8rem * 240 / ${diagramHeight})`,
      }}
    >
      <svg
        className={styles.diagram}
        viewBox={celtic ? '0 -8 240 162' : '0 0 240 128'}
        role="img"
        aria-label={`${spread.nameCn}，${spread.positions.length} 个牌位示意：${spread.positions.map((p) => p.nameCn).join('、')}`}
      >
        {positions.map(({ position, x, y }, index) => (
          <g key={position.id} data-position={index + 1} transform={`translate(${x} ${y})`}>
            <title>{`${index + 1}. ${position.nameCn}`}</title>
            <image
              href="/brand/spread-theme/card-back.webp"
              x={-width / 2}
              y={-height / 2}
              width={width}
              height={height}
              transform={celtic && index === 1 ? 'rotate(90)' : undefined}
            />
          </g>
        ))}
      </svg>
      {positions.map(({ position, labelX, labelY, labelSide }, index) => (
        <span
          key={position.id}
          data-position-label={index + 1}
          aria-hidden
          className={named ? styles.positionName : styles.positionNumber}
          style={{
            left: `${(labelX / 240) * 100}%`,
            top: `${((labelY + (celtic ? 8 : 0)) / diagramHeight) * 100}%`,
            transform:
              labelSide === 'left'
                ? 'translate(calc(-100% - 4px), -50%)'
                : labelSide === 'right'
                  ? 'translate(4px, -50%)'
                  : undefined,
          }}
        >
          {named ? position.nameCn : index + 1}
        </span>
      ))}
    </span>
  );
}

interface SpreadSelectorProps {
  choices?: readonly Spread[];
  selectedSpread: Spread;
  onSelect: (spread: Spread) => void;
  onConfirm?: () => void;
  confirmLabel?: string;
  title?: string;
  onInteractionChange?: (interacting: boolean) => void;
}

type Motion = {
  sourceId: string;
  offset: number;
  phase: 'dragging' | 'settling' | 'confirming' | 'idle';
};
type Gesture = { id: number; x: number; y: number; offset: number; dragging: boolean };

function tokenDuration(element: HTMLElement, token: string) {
  const value = getComputedStyle(element).getPropertyValue(token).trim();
  return (parseFloat(value) || 0) * (value.endsWith('ms') ? 1 : 1000);
}

export function SpreadSelector(props: SpreadSelectorProps) {
  if (props.choices?.length === 0) return <p role="status">暂无可选牌阵</p>;
  return <SpreadCarousel {...props} />;
}

function SpreadCarousel({
  choices = spreads,
  selectedSpread,
  onSelect,
  onConfirm,
  onInteractionChange,
  confirmLabel = '使用此牌阵，开始洗牌',
  title = '选择牌阵',
}: SpreadSelectorProps) {
  const wrap = (index: number) => (index + choices.length) % choices.length;
  const hintId = useId();
  const detailsId = useId();
  const [detailsSpreadId, setDetailsSpreadId] = useState<string | null>(null);
  const detailsOpen = detailsSpreadId === selectedSpread.id;
  const guidance = getSpreadGuidance(selectedSpread.id);
  const stage = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const pending = useRef<number | null>(null);
  const busy = useRef(false);
  const suppressClick = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const callbacks = useRef({ onSelect, onConfirm, onInteractionChange });
  const [motion, setMotion] = useState<Motion>({
    sourceId: selectedSpread.id,
    offset: 0,
    phase: 'idle',
  });
  if (motion.sourceId !== selectedSpread.id) {
    setMotion({ sourceId: selectedSpread.id, offset: 0, phase: 'idle' });
  }
  const index = choices.findIndex((spread) => spread.id === selectedSpread.id);
  const offset = motion.sourceId === selectedSpread.id ? motion.offset : 0;
  const phase = motion.sourceId === selectedSpread.id ? motion.phase : 'idle';

  useLayoutEffect(() => {
    callbacks.current = { onSelect, onConfirm, onInteractionChange };
  });
  useLayoutEffect(() => {
    // A parent-driven selection cancels any gesture/animation from the previous spread.
    return () => {
      clearTimeout(timer.current);
      gesture.current = null;
      pending.current = null;
      if (busy.current) callbacks.current.onInteractionChange?.(false);
      busy.current = false;
    };
  }, [selectedSpread.id]);

  function setBusy(value: boolean) {
    if (busy.current === value) return;
    busy.current = value;
    callbacks.current.onInteractionChange?.(value);
  }

  function finish() {
    const direction = pending.current;
    if (direction === null) return;
    pending.current = null;
    clearTimeout(timer.current);
    setMotion({ sourceId: selectedSpread.id, offset: 0, phase: 'idle' });
    if (direction !== 0) callbacks.current.onSelect(choices[wrap(index + direction)]);
    setBusy(false);
  }

  function settle(direction: number) {
    if (!stage.current) return;
    setBusy(true);
    pending.current = direction;
    if (stage.current.contains(document.activeElement))
      stage.current.focus({ preventScroll: true });
    setMotion({ sourceId: selectedSpread.id, offset: -direction, phase: 'settling' });
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const duration = reducedMotion ? 0 : tokenDuration(stage.current, '--dur-soft');
    // transitionend is primary; the token-derived fallback also unlocks hidden/cancelled transitions.
    timer.current = setTimeout(finish, duration * 1.5);
  }

  function navigate(direction: number) {
    if (!busy.current && !gesture.current) settle(direction);
  }

  function confirm() {
    if (!callbacks.current.onConfirm || busy.current) return;
    setBusy(true);
    setMotion({ sourceId: selectedSpread.id, offset: 0, phase: 'confirming' });
    const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? 0
      : tokenDuration(stage.current!, '--confirm-duration');
    // Share the CSS duration; cleanup cancels navigation if selection changes or the view leaves.
    timer.current = setTimeout(() => {
      setMotion({ sourceId: selectedSpread.id, offset: 0, phase: 'idle' });
      setBusy(false);
      callbacks.current.onConfirm?.();
    }, duration);
  }

  function stepWidth() {
    const card = stage.current?.querySelector<HTMLElement>('[data-slot="0"]');
    const step =
      stage.current && parseFloat(getComputedStyle(stage.current).getPropertyValue('--card-step'));
    return card && step ? card.offsetWidth * step : 0;
  }

  const wheelActions = useRef({ navigate, stepWidth });
  useLayoutEffect(() => {
    wheelActions.current = { navigate, stepWidth };
  });
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    let distance = 0;
    let switched = false;
    let wheelTimer: ReturnType<typeof setTimeout>;
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
      event.preventDefault();
      clearTimeout(wheelTimer);
      wheelTimer = setTimeout(
        () => {
          distance = 0;
          switched = false;
        },
        tokenDuration(element, '--dur-quick'),
      );
      if (switched || busy.current || gesture.current) return;
      const unit =
        event.deltaMode === 1
          ? parseFloat(getComputedStyle(element).fontSize)
          : event.deltaMode === 2
            ? element.clientWidth
            : 1;
      distance += event.deltaX * unit;
      const width = wheelActions.current.stepWidth();
      if (width && Math.abs(distance) >= width * SWIPE_THRESHOLD) {
        switched = true;
        wheelActions.current.navigate(Math.sign(distance));
      }
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => {
      element.removeEventListener('wheel', wheel);
      clearTimeout(wheelTimer);
    };
  }, []);

  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.isPrimary === false || event.button !== 0 || busy.current) return;
    suppressClick.current = false;
    gesture.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      offset: 0,
      dragging: false,
    };
  }

  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    const current = gesture.current;
    if (!current || current.id !== event.pointerId) return;
    const dx = event.clientX - current.x;
    const dy = event.clientY - current.y;
    if (!current.dragging) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < TAP_SLOP) return;
      if (Math.abs(dy) > Math.abs(dx)) {
        suppressClick.current = true;
        gesture.current = null;
        return;
      }
      current.dragging = true;
      suppressClick.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      setBusy(true);
    }
    const width = stepWidth();
    current.offset = width ? Math.max(-1, Math.min(1, dx / width)) : 0;
    setMotion({ sourceId: selectedSpread.id, offset: current.offset, phase: 'dragging' });
  }

  function pointerEnd(event: PointerEvent<HTMLDivElement>, cancelled = false) {
    const current = gesture.current;
    if (!current || current.id !== event.pointerId) return;
    gesture.current = null;
    if (current.dragging) {
      const width = stepWidth();
      const releasedOffset = width ? (event.clientX - current.x) / width : current.offset;
      const direction =
        !cancelled && Math.abs(releasedOffset) >= SWIPE_THRESHOLD ? -Math.sign(releasedOffset) : 0;
      settle(direction);
    }
  }

  return (
    <div className={styles.selector}>
      <div className={styles.heading}>
        <span className={styles.moonCrown} aria-hidden />
        <h1>{title}</h1>
        <p className={styles.english}>Reading Perspectives</p>
        <p>
          按问题与已知背景选择牌阵。
          <br />
          牌数代表观察角度，不代表准确程度。
        </p>
      </div>
      <div
        ref={stage}
        className={styles.stage}
        data-phase={phase}
        role="region"
        aria-roledescription="轮播"
        aria-label="选择牌阵"
        aria-describedby={hintId}
        aria-busy={phase !== 'idle'}
        tabIndex={0}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={(event) => pointerEnd(event)}
        onPointerLeave={() => {
          if (!gesture.current?.dragging) gesture.current = null;
        }}
        onPointerCancel={(event) => pointerEnd(event, true)}
        onLostPointerCapture={(event) => {
          // Touch transfers implicit capture from the card to this stage; that child's loss bubbles here.
          if (event.target === event.currentTarget) pointerEnd(event, true);
        }}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
          event.preventDefault();
          navigate(event.key === 'ArrowLeft' ? -1 : 1);
        }}
      >
        {SLOTS.map((slot) => {
          const spread = choices[wrap(index + slot)];
          const summary = getSpreadGuidance(spread.id)?.summary ?? spread.description;
          const position = slot + offset;
          const distance = Math.abs(position);
          const visible = Math.abs(slot) <= 1;
          return (
            <div
              key={slot}
              data-slot={slot}
              className={styles.card}
              aria-hidden={!visible}
              style={
                {
                  '--position': position,
                  '--scale': Math.max(0.72, 1 - distance * 0.14),
                  '--turn': `${Math.max(-1, Math.min(1, position)) * -9}deg`,
                  opacity: Math.max(0, 1 - distance * 0.55),
                  zIndex: 10 - Math.abs(slot),
                  pointerEvents: visible ? 'auto' : 'none',
                } as CSSProperties
              }
              onTransitionEnd={(event) => {
                if (event.propertyName === 'transform' && slot === 0) finish();
              }}
            >
              <button
                type="button"
                className={styles.cardSelect}
                data-spread-id={spread.id}
                data-slot={slot}
                aria-pressed={slot === 0}
                tabIndex={slot === 0 ? 0 : -1}
                aria-label={`${summary}，${spread.nameCn}，${spread.positions.length} 张`}
                onClick={(event) => {
                  if (busy.current) return;
                  if (suppressClick.current && event.detail !== 0) return;
                  if (slot !== 0) navigate(Math.sign(slot));
                  else confirm();
                }}
              >
                <h4>{spread.nameCn}</h4>
                <span className={styles.titleDivider} aria-hidden>
                  <span />
                </span>
                <span className={styles.meta}>{spread.positions.length} 张</span>
                <span className={styles.diagramWrap}>
                  <SpreadDiagram spread={spread} />
                </span>
                <span className={styles.descriptionMark} aria-hidden />
                <p>{summary}</p>
              </button>
              {slot === 0 && (
                <button
                  data-small-action="text"
                  type="button"
                  className={styles.detailsButton}
                  disabled={phase !== 'idle'}
                  aria-expanded={detailsOpen}
                  aria-controls={detailsId}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => setDetailsSpreadId(detailsOpen ? null : selectedSpread.id)}
                >
                  {detailsOpen ? '收起牌位说明' : '查看牌位说明'}
                </button>
              )}
            </div>
          );
        })}
      </div>
      <div className={styles.pagination} aria-hidden>
        {choices.map((spread) => (
          <span key={spread.id} data-active={spread.id === selectedSpread.id} />
        ))}
      </div>
      {guidance && (
        <section className={styles.guidancePanel} aria-label={`${selectedSpread.nameCn}适用场景`}>
          <dl>
            <div>
              <dt>适合的问题</dt>
              <dd>{guidance.suitableFor}</dd>
            </div>
            <div>
              <dt>请先说明</dt>
              <dd>{guidance.requiredContext}</dd>
            </div>
            <div>
              <dt>提问示例</dt>
              <dd>{guidance.exampleQuestion}</dd>
            </div>
            <div>
              <dt>解读边界</dt>
              <dd>{guidance.boundary}</dd>
            </div>
          </dl>
        </section>
      )}
      {detailsOpen && (
        <section
          id={detailsId}
          className={styles.detailsPanel}
          aria-label={`${selectedSpread.nameCn}牌位说明`}
        >
          <ol>
            {selectedSpread.positions.map((position) => (
              <li key={position.id}>
                <strong>{position.nameCn}</strong>
                <p>
                  {getSpreadPositionGuidance(position.id) ??
                    '以牌面主题提供观察角度，现实信息以你提供的内容为准。'}
                </p>
              </li>
            ))}
          </ol>
        </section>
      )}
      <p className={styles.pageNumber}>
        {String(index + 1).padStart(2, '0')} / {String(choices.length).padStart(2, '0')}
      </p>
      {onConfirm && (
        <button
          className={styles.primary}
          type="button"
          onClick={confirm}
          disabled={phase !== 'idle'}
        >
          {confirmLabel}
        </button>
      )}
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        当前{selectedSpread.nameCn}，{index + 1} / {choices.length}
      </span>
      <p id={hintId} className={styles.hint}>
        左右滑动，寻找心仪的牌阵
        <span className="sr-only">
          {confirmLabel}。也可使用左右方向键切换，聚焦牌阵后按回车确认。
        </span>
      </p>
    </div>
  );
}
