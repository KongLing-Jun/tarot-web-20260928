'use client';

import Image from 'next/image';
import type { RetryState } from '@/lib/api/stream-client';
import styles from './ReadingLoading.module.css';

interface Props {
  hasCards: boolean;
  thinking: string;
  retry?: RetryState | null;
  onDetailInteraction: () => void;
}

export function ReadingLoading(props: Props) {
  const { hasCards, retry } = props;
  const title = retry ? '正在重新连接' : hasCards ? '正在生成解读' : '正在选择牌阵';
  const description = retry
    ? `连接中断，正在重试（第 ${retry.attempt} / ${retry.max} 次）`
    : hasCards
      ? '牌面已就绪，解读将在这里呈现。'
      : '正在为你的问题选择牌阵，随后抽取牌面。';

  return (
    <section className={styles.waiting} aria-label="解读生成状态" data-retrying={Boolean(retry)}>
      <Image
        className={styles.cornerLeft}
        src="/brand/hero-corner.webp"
        width={114}
        height={120}
        alt=""
        aria-hidden="true"
        unoptimized
      />
      <Image
        className={styles.cornerRight}
        src="/brand/hero-corner.webp"
        width={114}
        height={120}
        alt=""
        aria-hidden="true"
        unoptimized
      />
      <Image
        className={styles.cornerBottomLeft}
        src="/brand/hero-corner.webp"
        width={114}
        height={120}
        alt=""
        aria-hidden="true"
        unoptimized
      />
      <Image
        className={styles.cornerBottomRight}
        src="/brand/hero-corner.webp"
        width={114}
        height={120}
        alt=""
        aria-hidden="true"
        unoptimized
      />
      <p className={styles.eyebrow} aria-hidden="true">
        Tarot &amp; AI Reflection
      </p>
      <div className={styles.art} aria-hidden="true">
        <Image
          className={styles.astrolabe}
          src="/brand/reading-astrolabe.webp"
          width={800}
          height={800}
          alt=""
          priority
          unoptimized
        />
        <Image
          className={styles.dial}
          src="/brand/reading-dial.webp"
          width={400}
          height={400}
          alt=""
          unoptimized
        />
        <div className={styles.orbit}>
          <Image
            className={`${styles.star} ${styles.trailFar}`}
            src="/brand/spread-theme/star.webp"
            width={80}
            height={100}
            alt=""
            unoptimized
          />
          <Image
            className={`${styles.star} ${styles.trailNear}`}
            src="/brand/spread-theme/star.webp"
            width={80}
            height={100}
            alt=""
            unoptimized
          />
          <Image
            className={styles.star}
            src="/brand/spread-theme/star.webp"
            width={80}
            height={100}
            alt=""
            unoptimized
          />
        </div>
      </div>
      <div className={styles.status} role="status" aria-live="polite" aria-atomic="true">
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      <Image
        className={styles.divider}
        src="/brand/hero-divider.webp"
        width={1044}
        height={68}
        alt=""
        aria-hidden="true"
        unoptimized
      />
      <GenerationInfo {...props} />
    </section>
  );
}

export function GenerationInfo({ hasCards, thinking, retry, onDetailInteraction }: Props) {
  return (
    <details
      className={styles.info}
      onToggle={(event) => {
        if (event.currentTarget.open) onDetailInteraction();
      }}
    >
      <summary onClick={onDetailInteraction}>
        <span className={styles.quill} aria-hidden="true" />
        <span>查看生成信息</span>
        <span className={styles.chevron} aria-hidden="true">
          ›
        </span>
      </summary>
      <div className={styles.infoBody}>
        <p>
          {retry
            ? `连接中断，正在重试（第 ${retry.attempt} / ${retry.max} 次）`
            : hasCards
              ? '牌面已就绪，正在等待解读内容返回。'
              : '问题已记录，正在选择牌阵与抽取牌面。'}
        </p>
        {thinking.trim() ? (
          <>
            <p className={styles.infoLabel}>模型返回的信息</p>
            <pre tabIndex={0} aria-label="模型返回的信息" className={styles.thinking}>
              {thinking}
            </pre>
          </>
        ) : (
          <p className={styles.infoLabel}>暂时没有更多生成信息。</p>
        )}
      </div>
    </details>
  );
}
