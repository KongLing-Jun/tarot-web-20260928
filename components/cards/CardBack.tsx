import Image from 'next/image';

interface CardBackProps {
  /** 扇形和小尺寸卡背减少装饰节点，同时停用持续旋转。 */
  compact?: boolean;
  animated?: boolean;
  className?: string;
  appearance?: 'default' | 'ritual';
}

// 24 道月相刻痕，每 15° 一道。
const LUNAR_TICK_COUNT = 24;

/** 纯装饰卡背；父容器提供尺寸和可访问名称。 */
export function CardBack({
  compact = false,
  animated = true,
  className = '',
  appearance = 'default',
}: CardBackProps) {
  if (appearance === 'ritual')
    return (
      <Image
        src="/brand/spread-theme/card-back.webp"
        alt=""
        aria-hidden
        width={240}
        height={420}
        unoptimized
        draggable={false}
        className={className}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          borderRadius: 'inherit',
        }}
      />
    );
  return (
    <div
      aria-hidden="true"
      className={`absolute inset-0 w-full h-full backface-hidden overflow-hidden bg-[var(--ink-void)] hairline ${className}`}
      style={{ transition: 'box-shadow 700ms var(--ease-veil)' }}
    >
      {/* 中央烛金径向辉光 · 极淡，悬停时微微苏醒 */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none opacity-55 group-hover:opacity-85 transition-opacity duration-700"
        style={{
          background:
            'radial-gradient(ellipse 72% 50% at 50% 46%, var(--gold-glow) 0%, var(--gold-faint) 36%, transparent 74%)',
          transitionTimingFunction: 'var(--ease-veil)',
        }}
      />

      {/* 旋转外环 · 月相刻度 · 120s 极慢公转（anim-lunar） */}
      <div
        aria-hidden
        className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-70 group-hover:opacity-100 transition-opacity duration-700"
        style={{ transitionTimingFunction: 'var(--ease-veil)' }}
      >
        <div
          className={`relative w-full aspect-square ${animated && !compact ? 'anim-lunar' : ''}`}
        >
          {/* 环体细线 · 刻度骑线而生 */}
          <span className="absolute inset-1 rounded-full border border-[var(--ink-line-strong)]" />
          {Array.from({ length: compact ? 0 : LUNAR_TICK_COUNT }, (_, i) => {
            const isCardinal = i % 6 === 0;
            const tone = isCardinal
              ? 'bg-[var(--gold-dim)]'
              : i % 2 === 0
                ? 'bg-[var(--bone-whisper)]'
                : 'bg-[var(--celestial-faint)]';
            return (
              <div
                key={i}
                className="absolute inset-0"
                style={{ transform: `rotate(${i * (360 / LUNAR_TICK_COUNT)}deg)` }}
              >
                <span
                  className={`absolute left-1/2 -translate-x-1/2 w-px ${
                    isCardinal ? 'h-2' : 'h-1'
                  } ${tone}`}
                />
              </div>
            );
          })}
        </div>
      </div>

      <div className="w-full h-full relative flex items-center justify-center">
        {/* 内框 · 0.5px 双层 */}
        <div className="absolute inset-2 hairline" />
        <div className="absolute inset-3.5 hairline-strong" />

        {/* 中央徽记 · ✦ 外加一圈缓转的虚线星环 */}
        <div
          className="relative flex flex-col items-center gap-3 transition-transform duration-700 group-hover:scale-105"
          style={{ transitionTimingFunction: 'var(--ease-veil)' }}
        >
          <div className="relative flex items-center justify-center">
            <span
              aria-hidden
              className={`absolute w-12 h-12 rounded-full border border-dashed border-[var(--gold-faint)] ${animated && !compact ? 'anim-lunar' : ''}`}
            >
              {/* 环顶星珠 · 令旋转可被感知 */}
              <span className="absolute -top-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-[var(--celestial-dim)]" />
            </span>
            <span className="text-gold-dim text-2xl">✦</span>
          </div>
          <span className="h-px w-10 bg-[var(--gold-faint)]" />
          <span className="font-heading text-bone-faint text-[10px] tracking-veil uppercase">
            Tarot
          </span>
        </div>

        {/* 角部刻痕 · 骨白与星蓝交替 */}
        <CornerTicks />
      </div>
    </div>
  );
}

/* 角部刻痕 · 对角同色：左上/右下 骨白，右上/左下 极淡星蓝 */
function CornerTicks() {
  const corners: ReadonlyArray<{ at: string; tone: string }> = [
    { at: 'top-3 left-3', tone: 'bg-[var(--bone-whisper)]' },
    { at: 'top-3 right-3', tone: 'bg-[var(--celestial-faint)]' },
    { at: 'bottom-3 left-3', tone: 'bg-[var(--celestial-faint)]' },
    { at: 'bottom-3 right-3', tone: 'bg-[var(--bone-whisper)]' },
  ];

  return (
    <>
      {corners.map(({ at, tone }) => (
        <span key={at} className={`absolute ${at}`} aria-hidden>
          <span className={`absolute w-2 h-px ${tone}`} />
          <span className={`absolute h-2 w-px ${tone}`} />
        </span>
      ))}
    </>
  );
}
