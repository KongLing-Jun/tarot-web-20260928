'use client';

import Link from 'next/link';
import { BRAND } from '@/lib/brand';
import { useState, type MouseEvent } from 'react';
import { MainNav } from '@/components/layout/MainNav';
import { DailyCardPreview } from '@/components/daily/DailyCardPreview';
import { spreads } from '@/lib/tarot/spreads';
import styles from './_styles/home/home-features.module.css';
import { HomeHero } from './_components/home/HomeHero';
import { HomeScenes } from './_components/home/HomeScenes';
import transition from '@/components/layout/PageTransition.module.css';

export default function Home() {
  const [entrance, setEntrance] = useState(0);
  function replayEntrance(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return;
    event.preventDefault();
    setEntrance((value) => value + 1);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  return (
    <div className="relative min-h-screen overflow-hidden">
      {/* ─── 固定侧边导航 ─── */}
      <MainNav activePath="/" onHomeClick={replayEntrance} />

      {/* ─── 散射装饰符号 ─── */}
      <span
        className="scatter-symbol text-2xl top-[68%] left-[15%] anim-drift"
        style={{ animationDelay: '2s' }}
        aria-hidden
      >
        ✧
      </span>
      <span
        className="scatter-symbol text-3xl bottom-[22%] right-[12%] anim-drift"
        style={{ animationDelay: '4s' }}
        aria-hidden
      >
        ✦
      </span>
      <span
        className="scatter-symbol text-xl top-[82%] left-[45%] anim-whisper"
        style={{ animationDelay: '1.5s' }}
        aria-hidden
      >
        ◇
      </span>

      {/* ─── 背景光弧装饰 ─── */}
      <div
        className="arc-glow w-[600px] h-[600px] -top-[200px] -right-[100px] hidden md:block"
        aria-hidden
      />
      <div
        className="arc-glow w-[400px] h-[400px] bottom-[10%] left-[5%] hidden md:block"
        style={{ animationDirection: 'reverse', animationDuration: '80s' }}
        aria-hidden
      />

      {/* ─── 主内容区 · 偏右以避开侧边栏 ─── */}
      <main key={entrance} id="main-content" className="md:pl-16 relative z-10">
        <HomeHero />
        <HomeScenes />

        <section
          className={`px-6 md:px-12 lg:px-20 pb-12 max-w-3xl ${transition.rise}`}
          style={{ animationDelay: '180ms' }}
          aria-label="每日一牌"
        >
          <DailyCardPreview />
        </section>

        {/* ─── 探索塔罗 · 古旧书封 ─── */}
        <section className={styles.section} aria-label="探索塔罗">
          <div className={`${styles.grid} ${transition.entries}`}>
            {/* 开始入口 */}
            <Link
              href="/agent"
              className={styles.card}
              aria-label={`开启旅程，Begin Your Journey，开始${BRAND.name}对话`}
            >
              <div className={styles.cardHeader}>
                <div className={styles.meta}>
                  <span className={styles.symbol} aria-hidden>
                    ✦
                  </span>
                </div>
                <h3 className={styles.title}>开启旅程</h3>
                <p className={styles.subtitle}>Begin Your Journey</p>
              </div>
              <div className={styles.cardDescription}>
                <p className={styles.description}>
                  写下问题，由 AI 推荐牌阵并生成解读；也可以自己选择牌阵，慢慢探索。
                </p>
                <span className={styles.arrow} aria-hidden>
                  →
                </span>
              </div>
            </Link>
            <FeatureBlock
              symbol="◇"
              number="78"
              title="七十八卷"
              subtitle="Rider-Waite Smith"
              text="浏览完整的 78 张塔罗牌，了解牌面图像、关键词和正逆位含义。"
              href="/library"
            />
            <FeatureBlock
              symbol="✦"
              number={String(spreads.length).padStart(2, '0')}
              title="牌阵与视角"
              href="/spreads"
              subtitle="Reading Perspectives"
              text="从单张牌到凯尔特十字，按问题选择牌阵，从不同角度梳理现状与选择。"
            />
            <FeatureBlock
              symbol="⊹"
              number="∞"
              title="AI 解读"
              subtitle="AI Interpretation"
              text="结合你的问题与牌面，生成解读，并支持继续追问。"
            />
          </div>
        </section>

        {/* ─── 底部签名 ─── */}
        <footer className={`px-6 md:px-12 lg:px-20 pb-12 md:pb-20 ${transition.fade}`}>
          <div className="flex items-center justify-between">
            <span className="font-heading text-tiny text-bone-whisper">
              <span className="brand-name">{BRAND.name}</span> · {BRAND.englishWordmark}
            </span>
            <div className="flex items-center gap-3">
              <span className="w-12 h-px bg-[var(--ink-line)]" />
              <span className="text-gold-faint text-xs anim-whisper">✦</span>
              <span className="w-12 h-px bg-[var(--ink-line)]" />
            </div>
            <span className="cn-hint text-bone-whisper hidden md:block">{BRAND.tagline}</span>
          </div>
        </footer>
      </main>
    </div>
  );
}

/* ─── 书封介绍卡 ─── */
interface FeatureBlockProps {
  symbol: string;
  number: string;
  title: string;
  subtitle: string;
  text: string;
  href?: string;
}

function FeatureBlock({ symbol, number, title, subtitle, text, href }: FeatureBlockProps) {
  const inner = (
    <>
      <div className={styles.cardHeader}>
        <div className={styles.meta}>
          <span className={styles.symbol} aria-hidden>
            {symbol}
          </span>
          <span className={styles.number}>{number}</span>
        </div>
        <h3 className={styles.title}>{title}</h3>
        <p className={styles.subtitle}>{subtitle}</p>
      </div>
      <div className={styles.cardDescription}>
        <p className={styles.description}>{text}</p>
        {href && (
          <span className={styles.arrow} aria-hidden>
            →
          </span>
        )}
      </div>
    </>
  );

  if (href) {
    return (
      <Link href={href} className={styles.card}>
        {inner}
      </Link>
    );
  }
  return <div className={styles.card}>{inner}</div>;
}
