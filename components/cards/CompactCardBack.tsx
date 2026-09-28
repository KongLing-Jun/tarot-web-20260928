'use client';

import { memo, useEffect, useRef, useState } from 'react';
import { CardBack } from './CardBack';
import { FAN } from './fan-geometry';

/** Same artwork canvas in the fan, during flight, and after landing. */
export const CompactCardBack = memo(function CompactCardBack({
  width,
  height,
  appearance = 'default',
}: {
  width?: number;
  height?: number;
  appearance?: 'default' | 'ritual';
}) {
  const container = useRef<HTMLSpanElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (width !== undefined && height !== undefined) return;
    const el = container.current;
    if (!el) return;
    const measure = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    observer?.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [width, height]);
  return (
    <span
      ref={container}
      aria-hidden="true"
      style={{ position: 'absolute', inset: 0, display: 'block', overflow: 'hidden' }}
    >
      <span
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          display: 'block',
          width: FAN.cardWidth,
          height: FAN.cardHeight,
          transformOrigin: 'top left',
          transform: `scale(${(width ?? size.width) / FAN.cardWidth}, ${(height ?? size.height) / FAN.cardHeight})`,
        }}
      >
        <CardBack compact animated={false} appearance={appearance} />
      </span>
    </span>
  );
});
