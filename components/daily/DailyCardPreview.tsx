'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { getDailyDraw, type DailyDraw } from '@/lib/tarot/daily';
import { CardBack } from '../cards/CardBack';
import styles from './DailyCardPreview.module.css';

export function DailyCardPreview() {
  const [draw, setDraw] = useState<DailyDraw | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let disposed = false;
    const refresh = () => {
      if (disposed) return;
      clearTimeout(timer);
      const now = new Date();
      const next = getDailyDraw(now);
      setDraw((current) => (current?.dateKey === next.dateKey ? current : next));
      // 按本地午夜调度，不假设一天固定为 24 小时。
      const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      timer = setTimeout(refresh, midnight.getTime() - now.getTime());
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    queueMicrotask(refresh);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', refresh);
    return () => {
      disposed = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', refresh);
    };
  }, []);

  if (!draw)
    return (
      <div className="home-daily-slot" aria-busy="true" aria-label="正在载入每日一牌">
        <div className={`home-daily-card ${styles.card}`} aria-hidden="true">
          <div className={styles.placeholder}>
            <CardBack appearance="ritual" animated={false} />
          </div>
          <div className={styles.captionPlaceholder} />
        </div>
      </div>
    );

  return <DailyPreviewCard key={draw.dateKey} draw={draw} />;
}

function DailyPreviewCard({ draw }: { draw: DailyDraw }) {
  const [revealed, setRevealed] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const revealTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const direction = draw.isReversed ? '逆位' : '正位';

  useEffect(() => {
    // 首页进场先展示牌背，随渐入自动翻开；首页重播或日期更新时重新挂载。
    revealTimer.current = setTimeout(() => setRevealed(true), 450);
    return () => clearTimeout(revealTimer.current);
  }, []);

  function toggleCard() {
    clearTimeout(revealTimer.current);
    setRevealed((value) => !value);
  }

  return (
    <div className="home-daily-slot">
      <div className={`home-daily-card ${styles.card}`}>
        <button
          type="button"
          className={styles.flipButton}
          onClick={toggleCard}
          aria-pressed={revealed}
          aria-label={
            revealed
              ? `今日一牌：${draw.card.nameCn}，${direction}，点击翻回牌背`
              : '点击翻开今日一牌'
          }
        >
          <span className={styles.rotator} data-revealed={revealed}>
            <span className={styles.back} aria-hidden="true">
              <CardBack appearance="ritual" animated={false} />
            </span>
            <span className={styles.front} aria-hidden={!revealed}>
              {imageFailed ? (
                <span className={styles.fallback}>
                  {draw.card.nameCn}
                  <small>{direction}</small>
                </span>
              ) : (
                <Image
                  unoptimized
                  src={draw.card.image}
                  alt={draw.card.nameCn}
                  width={300}
                  height={500}
                  sizes="(min-width: 768px) 288px, 224px"
                  className={`${styles.image} ${draw.isReversed ? styles.reversed : ''}`}
                  onError={() => setImageFailed(true)}
                  priority
                />
              )}
            </span>
          </span>
        </button>
        <div className="home-daily-caption">
          <div className="home-daily-meta">
            <span>今日一牌</span>
            <time dateTime={draw.dateKey}>{draw.dateKey}</time>
          </div>
          <div className={styles.details} aria-live="polite">
            {revealed ? (
              <>
                <p className="home-daily-name">
                  {draw.card.nameCn}
                  <span>{direction}</span>
                </p>
                <p className="home-daily-keywords">
                  {(draw.isReversed ? draw.card.keywords.reversed : draw.card.keywords.upright)
                    .slice(0, 3)
                    .join(' · ')}
                </p>
              </>
            ) : (
              <p className={styles.invitation}>给今天一个新的观察角度</p>
            )}
          </div>
          <p className={styles.hint}>
            {revealed ? '轻触牌面可翻回牌背' : '留一点时间，听听内心的声音'}
          </p>
          <Link href="/daily" className={`home-daily-more ${styles.guide}`}>
            查看今日指引 →
          </Link>
        </div>
      </div>
    </div>
  );
}
