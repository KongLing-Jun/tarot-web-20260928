'use client';

import { useEffect, useId, useRef } from 'react';
import styles from './BlinkingEyes.module.css';

const BLINK_TIME_SCALE = 2;

const ARTWORK = {
  home: {
    width: 650,
    height: 445,
    src: '/brand/miying-fox-eyelids.svg',
    far: [330, 173, 42, 49],
    near: [390, 190, 80, 43],
  },
  question: {
    width: 1200,
    height: 660,
    src: '/brand/question-fox-eyelids.svg',
    far: [740, 246, 46, 67],
    near: [813, 304, 100, 47],
  },
} as const;

export function BlinkingEyes({ variant = 'home' }: { variant?: keyof typeof ARTWORK }) {
  const artwork = ARTWORK[variant];
  const rootRef = useRef<SVGSVGElement>(null);
  const farLidRef = useRef<SVGRectElement>(null);
  const nearLidRef = useRef<SVGRectElement>(null);
  const clipId = useId();

  useEffect(() => {
    const root = rootRef.current;
    const farLid = farLidRef.current;
    const nearLid = nearLidRef.current;
    if (!root || !farLid || !nearLid || typeof window.matchMedia !== 'function') return;

    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let disposed = false;
    let visible = true;
    let frame = 0;
    let previousTime = 0;
    let elapsed = 0;
    let blinkStart = -1;
    let nextBlink = 1.6 + Math.random();
    let secondBlink = false;

    function setBlink(closure: number) {
      farLid!.setAttribute('height', String(artwork.far[3] * closure));
      nearLid!.setAttribute('height', String(artwork.near[3] * closure));
    }

    function draw(now: number) {
      // Resume the same blink smoothly after returning to the page.
      if (previousTime) elapsed += Math.min((now - previousTime) / 1000, 0.05);
      previousTime = now;
      if (elapsed >= nextBlink) {
        blinkStart = elapsed;
        const doubleBlink = !secondBlink && Math.random() < 0.25;
        nextBlink = elapsed + (doubleBlink ? 0.48 * BLINK_TIME_SCALE : 2.8 + Math.random() * 3.2);
        secondBlink = doubleBlink;
      }
      const age = (elapsed - blinkStart) / BLINK_TIME_SCALE;
      const blink =
        blinkStart < 0 || age > 0.32
          ? 0
          : age < 0.11
            ? (1 - Math.cos((Math.PI * age) / 0.11)) / 2
            : age < 0.16
              ? 1
              : (1 + Math.cos((Math.PI * (age - 0.16)) / 0.16)) / 2;
      setBlink(blink);
      frame = requestAnimationFrame(draw);
    }

    function syncPlayback() {
      cancelAnimationFrame(frame);
      previousTime = 0;
      if (motion.matches) setBlink(0);
      if (!disposed && !motion.matches && visible && !document.hidden) {
        frame = requestAnimationFrame(draw);
      }
    }

    const observer =
      typeof IntersectionObserver === 'undefined'
        ? undefined
        : new IntersectionObserver(([entry]) => {
            visible = entry.isIntersecting;
            syncPlayback();
          });
    observer?.observe(root);
    motion.addEventListener('change', syncPlayback);
    document.addEventListener('visibilitychange', syncPlayback);
    syncPlayback();

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer?.disconnect();
      motion.removeEventListener('change', syncPlayback);
      document.removeEventListener('visibilitychange', syncPlayback);
      setBlink(0);
    };
  }, [artwork]);

  return (
    <svg
      ref={rootRef}
      className={styles.eyes}
      data-artwork={variant}
      viewBox={`0 0 ${artwork.width} ${artwork.height}`}
      fill="none"
      focusable="false"
      aria-hidden="true"
    >
      <defs>
        <clipPath id={clipId} clipPathUnits="userSpaceOnUse">
          <rect
            ref={farLidRef}
            x={artwork.far[0]}
            y={artwork.far[1]}
            width={artwork.far[2]}
            height="0"
          />
          <rect
            ref={nearLidRef}
            x={artwork.near[0]}
            y={artwork.near[1]}
            width={artwork.near[2]}
            height="0"
          />
        </clipPath>
      </defs>
      <image
        href={artwork.src}
        width={artwork.width}
        height={artwork.height}
        clipPath={`url(#${clipId})`}
      />
    </svg>
  );
}
