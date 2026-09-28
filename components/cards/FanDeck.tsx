'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from 'react';
import { createPortal, flushSync } from 'react-dom';
import { CompactCardBack } from './CompactCardBack';
import { FAN, fanPoses, hitFan, type FanPose } from './fan-geometry';
import styles from './FanDeck.module.css';

export interface CardSource {
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
}
interface FanDeckProps {
  deckSize: number;
  selectedIndices: number[];
  previewIndex: number | null;
  disabled?: boolean;
  extracting?: boolean;
  onPreview: (index: number | null) => void;
  onExtract?: (index: number, source?: CardSource) => void;
}

// Stable gesture distances in CSS pixels, independent of card zoom.
const ZOOM = { min: 0.75, max: 2, step: 0.25 };
const PULL = { start: 10, confirm: 48 };
const TAP_SLOP = 6; // CSS pixels: a browsing gesture must not count as a second tap.
interface Point {
  x: number;
  y: number;
}
interface ZoomAnchor extends Point {
  clientX: number;
  clientY: number;
}
interface BrowseGesture {
  id: number;
  previous: number | null;
  index: number;
  poses: FanPose[];
  angleOffset: number;
  origin: Point;
  tapOrigin: Point;
  canTap: boolean;
  pulling: boolean;
  normal: Point;
  source: CardSource | null;
}
interface PinchGesture {
  distance: number;
  zoom: number;
  anchor: Point;
}
interface PullPreview {
  index: number;
  distance: number;
  x: number;
  y: number;
  source: CardSource | null;
}

export function FanDeck({
  deckSize,
  selectedIndices,
  previewIndex,
  disabled = false,
  extracting = false,
  onPreview,
  onExtract,
}: FanDeckProps) {
  const stage = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const arena = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<{ zoom: number; anchor: ZoomAnchor | null }>({
    zoom: 1,
    anchor: null,
  });
  const zoom = view.zoom;
  const reveal = useRef<number | null>(null);
  const pointers = useRef(new Map<number, Point>());
  const pinch = useRef<PinchGesture | null>(null);
  const suspended = useRef(false);
  const [pull, setPull] = useState<PullPreview | null>(null);
  const cards = useRef<(HTMLButtonElement | null)[]>([]);
  const [width, setWidth] = useState(0);
  // Keep the expanded neighborhood after extraction so the remaining cards do not jump.
  const [focus, setFocus] = useState<number | null>(null);
  const gesture = useRef<BrowseGesture | null>(null);
  const suppressClick = useRef(false);
  const extract = useRef(onExtract);
  useLayoutEffect(() => {
    extract.current = onExtract;
  }, [onExtract]);
  const poses = fanPoses(deckSize, previewIndex ?? focus, previewIndex);
  const available = poses.map((_, i) => i).filter((i) => !selectedIndices.includes(i));
  const before = previewIndex === null ? available : available.filter((i) => i < previewIndex);
  const previous = before[before.length - 1];
  const next = previewIndex === null ? available[0] : available.find((i) => i > previewIndex);

  useLayoutEffect(() => {
    const el = arena.current;
    if (!el) return;
    // Fit the complete arc into the height left after the real controls are laid out.
    const measure = () =>
      el.style.setProperty('--fan-fit-width', `${(el.clientHeight * FAN.width) / FAN.height}px`);
    measure();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    observer?.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    observer?.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  useLayoutEffect(() => {
    const el = viewport.current;
    const deck = stage.current;
    if (!el || !deck) return;
    setWidth(deck.clientWidth);
    if (view.anchor) {
      el.scrollLeft = deck.offsetLeft + view.anchor.x * deck.clientWidth - view.anchor.clientX;
      el.scrollTop = deck.offsetTop + view.anchor.y * deck.clientHeight - view.anchor.clientY;
    }
  }, [view]);

  useLayoutEffect(() => {
    const index = reveal.current;
    reveal.current = null;
    const el = viewport.current;
    if (zoom <= 1 || index === null || !el) return;
    // Reveal only the cropped edge, without moving the page or centering the card.
    const pose = fanPoses(deckSize, previewIndex ?? focus, previewIndex)[index];
    if (!pose) return;
    const scale = (stage.current?.clientWidth ?? 0) / FAN.width;
    const radians = (pose.angle * Math.PI) / 180;
    const halfWidth =
      ((Math.abs(Math.cos(radians)) * FAN.cardWidth +
        Math.abs(Math.sin(radians)) * FAN.cardHeight) *
        scale) /
      2;
    const halfHeight =
      ((Math.abs(Math.sin(radians)) * FAN.cardWidth +
        Math.abs(Math.cos(radians)) * FAN.cardHeight) *
        scale) /
      2;
    const x = (stage.current?.offsetLeft ?? 0) + pose.x * scale;
    const y = (stage.current?.offsetTop ?? 0) + pose.y * scale;
    el.scrollLeft = Math.max(
      x + halfWidth - el.clientWidth,
      Math.min(el.scrollLeft, x - halfWidth),
    );
    el.scrollTop = Math.max(
      y + halfHeight - el.clientHeight,
      Math.min(el.scrollTop, y - halfHeight),
    );
  }, [previewIndex, focus, zoom, deckSize]);

  const cardSource = (index: number): CardSource | null => {
    const el = cards.current[index];
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const matrix = getComputedStyle(el)
      .transform.match(/^matrix\(([^)]+)\)$/)?.[1]
      .split(',')
      .map(Number);
    const angle = matrix ? (Math.atan2(matrix[1], matrix[0]) * 180) / Math.PI : poses[index].angle;
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      width: el.offsetWidth,
      height: el.offsetHeight,
      angle,
    };
  };

  const requestExtraction = (index: number, source = cardSource(index)) => {
    if (source) extract.current?.(index, source);
    else extract.current?.(index);
  };

  const choose = (index: number | undefined, show = false) => {
    if (
      disabled ||
      index === undefined ||
      index === previewIndex ||
      selectedIndices.includes(index)
    )
      return;
    if (show) reveal.current = index;
    setFocus(index);
    onPreview(index);
  };
  const point = (event: PointerEvent<HTMLDivElement>, layout: FanPose[], angleOffset = 0) => {
    const rect = stage.current?.getBoundingClientRect();
    if (!rect?.width) return null;
    return hitFan(
      ((event.clientX - rect.left) * FAN.width) / rect.width,
      ((event.clientY - rect.top) * FAN.width) / rect.width,
      layout,
      selectedIndices,
      angleOffset,
    );
  };
  const cancel = useCallback(() => {
    if (gesture.current) {
      const previous = gesture.current.previous;
      gesture.current = null;
      setFocus(previous);
      onPreview(previous);
    }
    pinch.current = null;
    suspended.current = true;
    setPull(null);
    suppressClick.current = true;
  }, [onPreview]);

  useEffect(() => {
    const interrupt = () => {
      cancel();
      pointers.current.clear();
    };
    const visibility = () => {
      if (document.hidden) interrupt();
    };
    window.addEventListener('blur', interrupt);
    window.addEventListener('resize', interrupt);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('blur', interrupt);
      window.removeEventListener('resize', interrupt);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [cancel]);

  const zoomAround = (value: number, anchor: Point, client: Point) => {
    const rect = viewport.current?.getBoundingClientRect();
    if (!rect) return;
    setView({
      zoom: Math.min(ZOOM.max, Math.max(ZOOM.min, value)),
      anchor: { ...anchor, clientX: client.x - rect.left, clientY: client.y - rect.top },
    });
  };
  const keyboardZoom = (value: number) => {
    cancel();
    const rect = stage.current?.getBoundingClientRect();
    const outer = viewport.current?.getBoundingClientRect();
    if (!rect?.width || !outer) return;
    const client = { x: outer.left + outer.width / 2, y: outer.top + outer.height / 2 };
    zoomAround(
      value,
      { x: (client.x - rect.left) / rect.width, y: (client.y - rect.top) / rect.height },
      client,
    );
  };
  const pullAt = (current: BrowseGesture, client: Point): PullPreview => {
    const dx = client.x - current.origin.x;
    const dy = client.y - current.origin.y;
    const distance = Math.max(0, dx * current.normal.x + dy * current.normal.y);
    return {
      index: current.index,
      distance,
      x: current.normal.x * distance,
      y: current.normal.y * distance,
      source: current.source,
    };
  };
  const updatePinch = () => {
    if (!pinch.current || pointers.current.size !== 2) return;
    const [a, b] = [...pointers.current.values()];
    zoomAround(
      (pinch.current.zoom * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.current.distance,
      pinch.current.anchor,
      { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    );
  };
  const updateBrowse = (e: PointerEvent<HTMLDivElement>) => {
    const current = gesture.current;
    if (!current || current.id !== e.pointerId || disabled || suspended.current) return;
    const client = { x: e.clientX, y: e.clientY };
    if (Math.hypot(client.x - current.tapOrigin.x, client.y - current.tapOrigin.y) > TAP_SLOP)
      current.canTap = false;
    const candidate = pullAt(current, client);
    const tangent = Math.abs(
      (client.x - current.origin.x) * -current.normal.y +
        (client.y - current.origin.y) * current.normal.x,
    );
    if (
      onExtract &&
      (current.pulling || (candidate.distance > PULL.start && candidate.distance > tangent * 1.25))
    ) {
      if (!current.pulling) current.source = cardSource(current.index);
      current.pulling = true;
      setPull({ ...candidate, source: current.source });
      return;
    }
    const index = point(e, current.poses, current.angleOffset);
    if (index !== null && index !== current.index) {
      current.index = index;
      current.origin = client;
      const radians = (current.poses[index].angle * Math.PI) / 180;
      current.normal = { x: Math.sin(radians), y: -Math.cos(radians) };
      choose(index);
    }
  };

  return (
    <div
      className={styles.fan}
      style={
        {
          '--fan-aspect': `${FAN.width} / ${FAN.height}`,
          '--fan-card-width': `${(FAN.cardWidth / FAN.width) * 100}%`,
          '--fan-card-height': `${(FAN.cardHeight / FAN.height) * 100}%`,
        } as CSSProperties
      }
    >
      <div ref={arena} className={styles.arena}>
        <div
          ref={viewport}
          className={styles.viewport}
          onPointerDown={(e) => {
            if (disabled || e.button !== 0) return;
            e.preventDefault();
            const wasEmpty = pointers.current.size === 0;
            pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
            e.currentTarget.setPointerCapture?.(e.pointerId);
            if (wasEmpty) {
              suspended.current = false;
              suppressClick.current = false;
            }
            if (pointers.current.size > 2) {
              cancel();
              return;
            }
            if (pointers.current.size === 2) {
              cancel();
              const [a, b] = [...pointers.current.values()];
              const rect = stage.current?.getBoundingClientRect();
              if (rect?.width && rect.height) {
                pinch.current = {
                  distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
                  zoom,
                  anchor: {
                    x: ((a.x + b.x) / 2 - rect.left) / rect.width,
                    y: ((a.y + b.y) / 2 - rect.top) / rect.height,
                  },
                };
              }
              return;
            }
            // Touch target adjustment can redirect the event to an overlapping neighbour.
            const target = document.elementFromPoint
              ? document.elementFromPoint(e.clientX, e.clientY)
              : e.target;
            const hit =
              target instanceof Element
                ? target.closest<HTMLButtonElement>('[data-deck-index]')
                : null;
            const index =
              hit && e.currentTarget.contains(hit)
                ? Number(hit.dataset.deckIndex)
                : point(e, poses);
            if (index === null || selectedIndices.includes(index)) return;
            const rect = stage.current?.getBoundingClientRect();
            if (!rect?.width) return;
            const x = ((e.clientX - rect.left) * FAN.width) / rect.width - FAN.cx;
            const y = FAN.cy - ((e.clientY - rect.top) * FAN.width) / rect.width;
            const radians = (poses[index].angle * Math.PI) / 180;
            gesture.current = {
              id: e.pointerId,
              previous: previewIndex,
              index,
              poses,
              pulling: false,
              source: null,
              tapOrigin: { x: e.clientX, y: e.clientY },
              canTap: index === previewIndex,
              origin: { x: e.clientX, y: e.clientY },
              normal: { x: Math.sin(radians), y: -Math.cos(radians) },
              angleOffset: poses[index].angle - (Math.atan2(x, y) * 180) / Math.PI,
            };
            choose(index);
          }}
          onPointerMove={(e) => {
            if (!pointers.current.has(e.pointerId)) return;
            if (disabled) {
              cancel();
              return;
            }
            pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (pinch.current && pointers.current.size === 2) {
              updatePinch();
            } else updateBrowse(e);
          }}
          onPointerUp={(e) => {
            if (!pointers.current.has(e.pointerId)) return;
            pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (disabled) cancel();
            else if (pinch.current) updatePinch();
            else updateBrowse(e);
            const current = gesture.current;
            const candidate = current?.pulling
              ? pullAt(current, { x: e.clientX, y: e.clientY })
              : null;
            gesture.current = null;
            pinch.current = null;
            pointers.current.delete(e.pointerId);
            suppressClick.current = true;
            if (
              !disabled &&
              !suspended.current &&
              candidate &&
              candidate.distance >= PULL.confirm
            ) {
              // Commit the final preview before invoking the parent's latest extraction callback.
              flushSync(() => setPull(candidate));
              requestExtraction(
                candidate.index,
                candidate.source
                  ? {
                      ...candidate.source,
                      x: candidate.source.x + candidate.x,
                      y: candidate.source.y + candidate.y,
                    }
                  : null,
              );
            } else if (
              !disabled &&
              !suspended.current &&
              current?.canTap &&
              !current.pulling &&
              current.index === current.previous
            ) {
              requestExtraction(current.index);
            }
            setPull(null);
          }}
          onPointerCancel={(e) => {
            pointers.current.delete(e.pointerId);
            cancel();
          }}
          onLostPointerCapture={(e) => {
            if (pointers.current.has(e.pointerId)) {
              pointers.current.delete(e.pointerId);
              cancel();
            }
          }}
        >
          <div
            ref={stage}
            role="region"
            aria-label="半圆环牌堆"
            aria-describedby="fan-instructions"
            className={styles.stage}
            style={{
              width: `${zoom * 100}%`,
              maxWidth: `calc(var(--fan-fit-width, 100%) * ${zoom})`,
            }}
            tabIndex={0}
            onKeyDown={(e) => {
              if (disabled || pointers.current.size) return;
              if (['+', '=', '-', '0'].includes(e.key)) {
                e.preventDefault();
                keyboardZoom(e.key === '0' ? 1 : zoom + (e.key === '-' ? -ZOOM.step : ZOOM.step));
                return;
              }
              const index =
                e.key === 'Home'
                  ? available[0]
                  : e.key === 'End'
                    ? available[available.length - 1]
                    : e.key === 'ArrowLeft'
                      ? previous
                      : e.key === 'ArrowRight'
                        ? next
                        : undefined;
              if (['Home', 'End', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
                e.preventDefault();
                choose(index, true);
                if (e.target !== e.currentTarget && index !== undefined)
                  cards.current[index]?.focus({ preventScroll: true });
              }
            }}
          >
            {poses.map((pose, index) => {
              const selected = selectedIndices.includes(index);
              const active = previewIndex === index;
              return (
                <button
                  key={index}
                  ref={(el) => {
                    cards.current[index] = el;
                  }}
                  type="button"
                  data-deck-index={index}
                  className={`${styles.target} ${selected ? styles.selected : ''} ${active ? styles.active : ''} ${pull?.index === index || (extracting && active) ? styles.pulling : ''}`}
                  style={
                    {
                      left: `${(pose.x / FAN.width) * 100}%`,
                      top: `${(pose.y / FAN.height) * 100}%`,
                      transform: `translate(-50%, -50%) rotate(${pose.angle}deg)`,
                      translate: pull?.index === index ? `${pull.x}px ${pull.y}px` : undefined,
                      zIndex: active
                        ? deckSize + 5
                        : previewIndex !== null && Math.abs(index - previewIndex) <= 2
                          ? deckSize + 2 - Math.abs(index - previewIndex)
                          : index + 1,
                      '--fold-x': `${((FAN.cx - pose.x) / FAN.cardWidth) * 100}%`,
                      '--fold-y': `${((FAN.cy - pose.y) / FAN.cardHeight) * 100}%`,
                    } as CSSProperties
                  }
                  disabled={selected || disabled}
                  aria-pressed={active}
                  tabIndex={index === (previewIndex ?? available[0]) ? 0 : -1}
                  aria-label={`牌堆第 ${index + 1} 张，${selected ? '已抽取' : '未翻开'}`}
                  onClick={(e) => {
                    if (e.detail !== 0 && suppressClick.current) return;
                    if (active) requestExtraction(index);
                    else choose(index, e.detail === 0);
                  }}
                >
                  <span className={styles.surface}>
                    {!selected && (
                      <CompactCardBack
                        appearance="ritual"
                        width={(width * FAN.cardWidth) / FAN.width}
                        height={(width * FAN.cardHeight) / FAN.width}
                      />
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <div className={styles.navigation}>
        <p id="fan-instructions" aria-live="polite">
          {extracting
            ? '这张牌，正在来到你面前'
            : disabled
              ? '牌已选齐'
              : pull
                ? pull.distance >= PULL.confirm
                  ? '松手抽取这张'
                  : '继续向外拖出'
                : previewIndex === null
                  ? '轻点一张牌，让它亮起'
                  : '再点高亮的牌，即可抽取'}
          <br />
          <span>
            {extracting
              ? '牌面将在揭牌时呈现'
              : pull
                ? '拖回牌堆可取消'
                : zoom > 1
                  ? '双指移动查看 · 捏合缩小牌堆'
                  : '沿弧轻拨选牌 · 双指缩放查看'}
          </span>
        </p>
      </div>
      {pull?.source &&
        createPortal(
          <div
            data-draw-pull
            aria-hidden="true"
            className={styles.pullCard}
            style={{
              left: pull.source.x + pull.x,
              top: pull.source.y + pull.y,
              width: pull.source.width,
              height: pull.source.height,
              transform: `translate(-50%, -50%) rotate(${pull.source.angle}deg)`,
            }}
          >
            <CompactCardBack
              appearance="ritual"
              width={pull.source.width}
              height={pull.source.height}
            />
          </div>,
          document.body,
        )}
    </div>
  );
}
