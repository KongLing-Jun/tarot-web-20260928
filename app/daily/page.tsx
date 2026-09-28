'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { BRAND } from '@/lib/brand';

import { TarotCardComponent } from '@/components/cards/TarotCard';
import { InterpretationBody } from '@/components/reading/Interpretation';
import { DailyCardSkeleton } from '@/components/common/Skeletons';
import { useApiConfig } from '@/hooks/useApiConfig';
import { streamInterpret } from '@/lib/api/stream-client';
import { LLMError } from '@/lib/api/errors';
import { hasValidAnswer } from '@/lib/api/generation-result';
import { presentGeneration } from '@/lib/api/generation-presentation';
import { validateInterpretationQuality } from '@/lib/interpretation-quality';
import {
  formatDateKey,
  getDailyDraw,
  getRecentDailyDraws,
  parseDateKey,
  type DailyDraw,
} from '@/lib/tarot/daily';
import {
  getAllDailyNotes,
  getDailyEntry,
  hasLegacyDailyNotes,
  importLegacyDailyNotes,
} from '@/lib/dailyStorage';
import { useDailyNote } from '@/hooks/useDailyNote';
import { MainNav } from '@/components/layout/MainNav';
import homeStyles from '../_styles/home/home-hero.module.css';
import styles from './daily.module.css';

/* ─── 中文星期 ─── */
const WEEKDAYS_CN = ['日', '一', '二', '三', '四', '五', '六'];

function formatHumanDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}.${m}.${d}`;
}

function formatHumanWeekday(date: Date): string {
  return `星期${WEEKDAYS_CN[date.getDay()]}`;
}

/** MM.DD · 时间线上的短日期 */
function formatShortDate(date: Date): string {
  return `${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`;
}

/* ─── 关键词散落位 · 环绕主卡漂浮 ─── */
interface KeywordSpot {
  pos: string;
  driftDelay: string;
  twinkleDelay: string;
  symbol: string;
}

const KEYWORD_SPOTS: ReadonlyArray<KeywordSpot> = [
  {
    pos: 'left-[4%] top-[21%] sm:left-[12%] lg:left-[19%]',
    driftDelay: '0ms',
    twinkleDelay: '-0.6s',
    symbol: '✦',
  },
  {
    pos: 'right-[3%] top-[27%] sm:right-[10%] lg:right-[17%]',
    driftDelay: '-3.8s',
    twinkleDelay: '-1.9s',
    symbol: '◇',
  },
  {
    pos: 'left-[7%] bottom-[27%] sm:left-[15%] lg:left-[22%]',
    driftDelay: '-7.2s',
    twinkleDelay: '-2.7s',
    symbol: '✧',
  },
  {
    pos: 'right-[6%] bottom-[21%] sm:right-[13%] lg:right-[21%]',
    driftDelay: '-1.6s',
    twinkleDelay: '-0.2s',
    symbol: '⊹',
  },
  {
    pos: 'left-[24%] top-[10%] hidden md:flex lg:left-[30%]',
    driftDelay: '-5.4s',
    twinkleDelay: '-1.2s',
    symbol: '✦',
  },
  {
    pos: 'right-[22%] bottom-[9%] hidden md:flex lg:right-[28%]',
    driftDelay: '-9.1s',
    twinkleDelay: '-2.2s',
    symbol: '◇',
  },
];

export default function DailyCardPage() {
  /* ─── 当前查看的日期（默认今天）
     初创为 null 避免 SSR/CSR 时区不一致造成的 hydration mismatch ─── */
  const [activeDateKey, setActiveDateKey] = useState<string | null>(null);
  const [activeDate, setActiveDate] = useState<Date | null>(null);
  const [todayKey, setTodayKey] = useState<string | null>(null);

  // 挂载后才取本地日期
  useEffect(() => {
    const now = new Date();
    queueMicrotask(() => {
      setActiveDate(now);
      setActiveDateKey(formatDateKey(now));
      setTodayKey(formatDateKey(now));
    });
  }, []);

  /* ─── 当日牌（挂载后计算） ─── */
  const dailyDraw = useMemo<DailyDraw | null>(() => {
    if (!activeDateKey) return null;
    const d = parseDateKey(activeDateKey) ?? new Date();
    return getDailyDraw(d);
  }, [activeDateKey]);

  /* ─── 翻牌动画：进入页面 / 切换日期时延迟翻开 ─── */
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    if (!activeDateKey) return;
    queueMicrotask(() => setRevealed(false));
    const t = window.setTimeout(() => setRevealed(true), 280);
    return () => window.clearTimeout(t);
  }, [activeDateKey]);

  /* ─── AI 解读 ─── */
  const { config: apiConfig } = useApiConfig();
  const [aiInterpretation, setAiInterpretation] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [notedDates, setNotedDates] = useState<Set<string>>(new Set());
  const dailyAbortRef = useRef<AbortController | null>(null);
  const unsavedInterpretation = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      void getAllDailyNotes()
        .then((notes) => {
          if (active) setNotedDates(new Set(notes.map((note) => note.dateKey)));
        })
        .catch(() => {
          if (active) setAiError('札记轨迹读取失败，请刷新重试');
        });
    };
    refresh();
    window.addEventListener('daily-notes-updated', refresh);
    return () => {
      active = false;
      window.removeEventListener('daily-notes-updated', refresh);
    };
  }, []);

  // 切换日期时清空 AI 解读并取消进行中的请求
  useEffect(() => {
    let active = true;
    unsavedInterpretation.current = null;
    if (dailyAbortRef.current) {
      dailyAbortRef.current.abort();
      dailyAbortRef.current = null;
    }
    queueMicrotask(() => {
      setAiInterpretation('');
      setAiError(null);
      setAiLoading(false);
    });
    if (activeDateKey)
      void getDailyEntry(activeDateKey, true)
        .then((entry) => {
          if (!active) return;
          setAiInterpretation(entry?.interpretation ?? '');
          if (
            entry?.interpretationStatus &&
            (entry.interpretationStatus !== 'done' || !hasValidAnswer(entry.interpretation))
          ) {
            setAiError('上次解读尚未完成，已保留生成的内容，可以重试。');
          }
        })
        .catch((error) => {
          if (active) setAiError(error instanceof Error ? error.message : '每日记录读取失败');
        });
    return () => {
      active = false;
      dailyAbortRef.current?.abort();
    };
  }, [activeDateKey]);

  const requestAiInterpretation = useCallback(async () => {
    if (!dailyDraw || !activeDate || aiLoading) return;
    if (unsavedInterpretation.current) {
      const pending = unsavedInterpretation.current;
      try {
        const entry = await getDailyEntry(dailyDraw.dateKey);
        if (unsavedInterpretation.current !== pending) return;
        if (entry?.interpretation === pending && entry.interpretationStatus === 'done') {
          unsavedInterpretation.current = null;
          setAiError(null);
        } else setAiError('解读内容已保留，但历史记录仍未保存，请稍后重试确认。');
      } catch {
        if (unsavedInterpretation.current === pending)
          setAiError('暂时无法确认保存状态，已保留当前解读，请稍后重试。');
      }
      return;
    }

    // 取消旧请求
    if (dailyAbortRef.current) dailyAbortRef.current.abort();
    const controller = new AbortController();
    dailyAbortRef.current = controller;

    setAiLoading(true);
    setAiInterpretation('');
    setAiError(null);

    try {
      await getDailyEntry(dailyDraw.dateKey, true);
      if (controller.signal.aborted) return;
      const keywords = dailyDraw.isReversed
        ? dailyDraw.card.keywords.reversed
        : dailyDraw.card.keywords.upright;
      const meaning = dailyDraw.isReversed
        ? dailyDraw.card.meaning.reversed
        : dailyDraw.card.meaning.upright;

      const result = await streamInterpret(
        {
          question: '',
          spread: {
            id: 'daily',
            name: 'Daily Card',
            nameCn: '今日一牌',
            description: '',
            positions: [],
          },
          drawnCards: [],
          apiConfig,
          daily: {
            dateKey: dailyDraw.dateKey,
            cardName: dailyDraw.card.name,
            cardNameCn: dailyDraw.card.nameCn,
            isReversed: dailyDraw.isReversed,
            keywords,
            meaning,
            dateStr: formatHumanDate(activeDate),
          },
        },
        {
          onContent: (chunk) => {
            if (!controller.signal.aborted) setAiInterpretation((prev) => prev + chunk);
          },
          onThinking: (chunk) => {
            if (!controller.signal.aborted) setAiInterpretation((prev) => prev + chunk);
          },
          onStreamError: (msg) => {
            if (!controller.signal.aborted) setAiError(msg);
          },
          onRetry: () => {
            if (!controller.signal.aborted) setAiInterpretation('');
          },
        },
        { signal: controller.signal },
      );
      if (controller.signal.aborted) return;
      if (result.fullText) setAiInterpretation(result.fullText);
      const quality = validateInterpretationQuality(result.fullText, {
        mode: 'daily',
        drawnCards: [
          {
            card: dailyDraw.card,
            isReversed: dailyDraw.isReversed,
            position: { id: 'daily', name: 'Daily Card', nameCn: '今日一牌', description: '' },
          },
        ],
      });
      const presentation = presentGeneration({ ...result, quality }, result.fullText);
      if (result.persistenceStatus === 'failed') {
        unsavedInterpretation.current = result.fullText;
        setAiError('解读内容已保留，但历史记录保存失败，请稍后重试确认。');
        return;
      }
      if (presentation.error || presentation.notice)
        setAiError(presentation.error ?? presentation.notice);
    } catch (err) {
      // 用户取消静默处理
      if (controller.signal.aborted || (err instanceof LLMError && err.info.code === 'ABORTED'))
        return;
      setAiError(
        err instanceof LLMError
          ? err.info.message
          : err instanceof Error
            ? err.message
            : 'AI 解读失败',
      );
    } finally {
      if (dailyAbortRef.current === controller) {
        setAiLoading(false);
        dailyAbortRef.current = null;
      }
    }
  }, [dailyDraw, activeDate, aiLoading, apiConfig]);

  /* ─── 最近 14 天的轨迹 · 取决于本地今日 ─── */
  const recent = useMemo(() => {
    const today = todayKey ? parseDateKey(todayKey) : null;
    return today ? getRecentDailyDraws(14, today) : [];
  }, [todayKey]);

  // 最近的记录优先展示，便于回看昨天与前天。
  const timeline = recent;

  /* ─── 是否在看今天 ─── */
  const isToday = activeDateKey !== null && activeDateKey === todayKey;

  const handleSelectDate = (draw: DailyDraw): void => {
    const d = parseDateKey(draw.dateKey);
    if (!d) return;
    setActiveDate(d);
    setActiveDateKey(draw.dateKey);
    document.getElementById('main-content')?.scrollIntoView?.({ block: 'start' });
  };

  const handleBackToToday = (): void => {
    const today = new Date();
    setActiveDate(today);
    setActiveDateKey(formatDateKey(today));
  };

  // 未挂载完成（未拿到本地今日）之前呈现骨架屏，避免 hydration mismatch
  if (!activeDateKey || !activeDate || !dailyDraw) {
    return (
      <div className={styles.page}>
        <DailyCardSkeleton />
        <div className={styles.mobileNav}>
          <MainNav activePath="/daily" />
        </div>
      </div>
    );
  }

  const keywords = dailyDraw.isReversed
    ? dailyDraw.card.keywords.reversed
    : dailyDraw.card.keywords.upright;
  const meaning = dailyDraw.isReversed
    ? dailyDraw.card.meaning.reversed
    : dailyDraw.card.meaning.upright;
  const directionCn = dailyDraw.isReversed ? '逆 位' : '正 位';
  const directionEn = dailyDraw.isReversed ? 'Reversed' : 'Upright';

  return (
    <div className={`relative ${styles.page}`}>
      <main id="main-content">
        {/* ═══ 第一幕 · 揭示之厅 ─── 牌是绝对主角 ─══ */}
        <section
          className={`act-fullscreen overflow-hidden ${styles.hero}`}
          aria-label={isToday ? '今日一牌' : '昔日之牌'}
        >
          {/* ─── 导航 · 仅一枚返回链接，栖于左上 ─── */}
          <header className={`absolute inset-x-0 top-0 z-30 p-6 md:p-10 ${styles.header}`}>
            <Image
              src="/brand/profile-theme/moon-cloud.webp"
              alt=""
              aria-hidden
              width={360}
              height={320}
              loading="eager"
              className={styles.headerMoon}
            />
            <div className="flex items-start justify-between">
              <div className={`anim-fade-in ${styles.headerTitle}`}>
                <Link
                  data-small-action="icon"
                  data-small-icon="back"
                  href="/"
                  aria-label="返回首页"
                  className={`group inline-flex items-center gap-3 text-bone-dim transition-colors duration-500 hover:text-gold-dim ${styles.back}`}
                  style={{ transitionTimingFunction: 'var(--ease-ritual)' }}
                >
                  <span
                    className="text-base transition-transform duration-700 group-hover:-translate-x-1"
                    style={{ transitionTimingFunction: 'var(--ease-veil)' }}
                  >
                    ←
                  </span>
                  <span className="cn-nav">返 回</span>
                </Link>

                <h1
                  className={`mt-8 font-heading text-sm tracking-[0.32em] text-bone md:text-base ${styles.title}`}
                >
                  {isToday ? '今日一牌' : '昔日之牌'}
                  <span aria-hidden className={styles.titleRule} />
                </h1>
                <p className={styles.english}>A Daily Note</p>
                <p className={`mt-3 font-heading text-tiny text-bone-whisper ${styles.date}`}>
                  {formatHumanDate(activeDate)} · {formatHumanWeekday(activeDate)}
                </p>
              </div>

              {!isToday && (
                <button
                  data-small-action="text"
                  type="button"
                  onClick={handleBackToToday}
                  className="btn-ink-ghost anim-fade-in"
                >
                  回 到 今 日
                </button>
              )}
            </div>
          </header>

          {/* ─── 右缘竖排侧标 · 仪式场记 ─── */}
          <div
            aria-hidden
            className="absolute right-8 top-1/2 z-20 hidden -translate-y-1/2 lg:block"
          >
            <span className="text-vertical font-heading text-tiny text-bone-whisper">
              {isToday ? 'CARD OF THE DAY' : 'CARD OF THE PAST'} — {formatHumanDate(activeDate)}
            </span>
          </div>

          {/* ─── 星尘散点 ─── */}
          <span
            aria-hidden
            className="scatter-symbol left-[11%] top-[16%] text-base anim-twinkle"
            style={{ animationDelay: '-0.8s' }}
          >
            ✦
          </span>
          <span
            aria-hidden
            className="scatter-symbol right-[13%] top-[13%] text-sm anim-twinkle"
            style={{ animationDelay: '-2.1s' }}
          >
            ✧
          </span>
          <span
            aria-hidden
            className="scatter-symbol left-[6%] top-[56%] text-lg anim-twinkle"
            style={{ animationDelay: '-1.4s' }}
          >
            ◇
          </span>
          <span
            aria-hidden
            className="scatter-symbol right-[7%] top-[62%] text-base anim-twinkle"
            style={{ animationDelay: '-2.9s' }}
          >
            ⊹
          </span>
          <span
            aria-hidden
            className="scatter-symbol left-[21%] bottom-[10%] text-sm anim-twinkle"
            style={{ animationDelay: '-0.3s' }}
          >
            ✧
          </span>
          <span
            aria-hidden
            className="scatter-symbol right-[19%] bottom-[8%] text-base anim-twinkle"
            style={{ animationDelay: '-1.8s' }}
          >
            ✦
          </span>

          {/* ─── 关键词 · 散落漂浮于牌的四周 ─── */}
          {revealed && <ScatteredKeywords keywords={keywords} />}

          {/* ─── 中央：光晕 + 轨道环 + 主卡 ─── */}
          <div
            key={activeDateKey}
            className={`anim-veil-rise relative z-10 flex flex-col items-center ${styles.reveal}`}
          >
            <div className={`relative ${styles.cardStage}`}>
              <div aria-hidden className={styles.solarCorona} />
              {/* 径向金辉 · 由中心向外熄灭 */}
              <div
                aria-hidden
                className={`pointer-events-none absolute left-1/2 top-1/2 h-[30rem] w-[30rem] -translate-x-1/2 -translate-y-1/2 md:h-[48rem] md:w-[48rem] ${styles.desktopAura}`}
                style={{
                  background:
                    'radial-gradient(circle, rgba(212,184,115,0.16) 0%, rgba(201,169,97,0.07) 30%, rgba(201,169,97,0.025) 52%, transparent 72%)',
                }}
              />
              {/* 内层烛芯 · 缓慢呼吸 */}
              <div
                aria-hidden
                className={`anim-whisper pointer-events-none absolute left-1/2 top-1/2 h-[16rem] w-[16rem] -translate-x-1/2 -translate-y-1/2 md:h-[24rem] md:w-[24rem] ${styles.desktopAura}`}
                style={{
                  background:
                    'radial-gradient(circle, rgba(232,213,163,0.12) 0%, rgba(212,184,115,0.05) 45%, transparent 70%)',
                  animationDuration: '7s',
                }}
              />
              {/* 轨道环 · 内环缓转 */}
              <div
                aria-hidden
                className={`pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 ${styles.desktopAura}`}
              >
                <div className="relative h-[22rem] w-[22rem] md:h-[34rem] md:w-[34rem]">
                  <span className="arc-glow inset-0" />
                </div>
              </div>
              {/* 轨道环 · 外环逆行虚线 */}
              <div
                aria-hidden
                className={`pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 ${styles.desktopAura}`}
              >
                <div className="relative h-[27rem] w-[27rem] md:h-[44rem] md:w-[44rem]">
                  <span
                    className="arc-glow inset-0"
                    style={{
                      borderStyle: 'dashed',
                      animationDuration: '95s',
                      animationDirection: 'reverse',
                    }}
                  />
                </div>
              </div>

              {/* 主卡 · 悬浮于光晕之上 */}
              <div className="float-card relative z-10">
                <TarotCardComponent
                  card={dailyDraw.card}
                  isReversed={dailyDraw.isReversed}
                  isRevealed={revealed}
                  appearance="ritual"
                  onClick={() => setRevealed(true)}
                  className={`w-64 md:w-80 lg:w-96 aspect-[3/5] ${styles.card}`}
                />
              </div>
            </div>

            {/* ─── 牌名 · 揭示的戏剧时刻 ─── */}
            <div
              className={`mt-12 min-h-[13rem] text-center md:mt-16 md:min-h-[15rem] ${styles.caption}`}
            >
              {revealed ? (
                <div className={`anim-veil-rise ${styles.cardDetails}`}>
                  <p className={styles.encounter}>{isToday ? '今日与你相遇' : '那日与你相遇'}</p>
                  <div
                    className={`mb-6 flex items-center justify-center gap-3 ${styles.direction}`}
                  >
                    <span
                      aria-hidden
                      className={`text-sm ${styles.directionMark} ${dailyDraw.isReversed ? 'text-mist' : 'text-gold-dim'}`}
                    >
                      {dailyDraw.isReversed ? '◇' : '✦'}
                    </span>
                    <span className="cn-nav text-bone">{directionCn}</span>
                    <span className="font-heading text-tiny text-bone-whisper">{directionEn}</span>
                  </div>
                  <h2 className={`font-heading text-massive text-bone ${styles.cardName}`}>
                    {dailyDraw.card.nameCn}
                  </h2>
                  <p
                    className={`font-display text-gold-foil mt-4 text-base uppercase tracking-[0.3em] md:text-xl ${styles.englishName}`}
                  >
                    {dailyDraw.card.name}
                  </p>
                  <ul className={styles.keywords} aria-label="牌面关键词">
                    {keywords.map((keyword) => (
                      <li key={keyword}>{keyword}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="anim-fade-in pt-10">
                  <p className="cn-hint anim-whisper text-bone-whisper">
                    轻 触 牌 面 · 查 看 今 日 牌
                  </p>
                </div>
              )}
            </div>
            {revealed && (
              <p
                className={`font-body italic-soft mx-auto mt-7 max-w-md px-4 text-sm leading-relaxed text-bone-dim md:text-base ${styles.meaning}`}
              >
                {meaning}
              </p>
            )}
          </div>

          {/* ─── 底部指引 ─── */}
          <a
            href="#oracle"
            className={`absolute bottom-7 left-1/2 z-20 flex -translate-x-1/2 flex-col items-center gap-2.5 text-bone-whisper transition-colors duration-500 hover:text-gold-dim ${styles.guide}`}
          >
            <span className="cn-hint">解 读 · 札 记 · 轨 迹</span>
            <span className="anim-whisper text-xs text-gold-dim">↓</span>
          </a>
        </section>

        {/* ═══ 第二幕 · 神谕 ─── 羊皮卷自上方徐徐展开 ═══ */}
        <section
          id="oracle"
          className={`relative z-10 px-6 pb-24 pt-10 md:px-10 md:pb-32 ${styles.section}`}
        >
          <div className="mx-auto max-w-2xl">
            <div className={`ornament-divider mb-12 ${styles.oracleDivider}`}>
              <span className="ornament-gem" />
            </div>

            <div
              className={`mb-9 flex items-center gap-3 ${styles.sectionHeading} ${styles.oracleHeading}`}
            >
              <span aria-hidden className={`text-base text-gold-dim ${styles.sectionMark}`}>
                ◆
              </span>
              <h3 className="cn-label text-gold-dim">今 日 解 读</h3>
              <div className="rule-h-fade flex-1" />
              <span className="font-heading text-tiny text-bone-whisper">AI Reading</span>
            </div>

            {!aiInterpretation && !aiLoading && !aiError && (
              <div
                className={`anim-fade-in flex flex-col items-center gap-6 ${styles.oraclePrompt}`}
              >
                <p className="font-body italic-soft text-sm text-bone-faint">
                  结合今日牌面，给自己一个新的观察角度
                </p>
                <button
                  type="button"
                  onClick={requestAiInterpretation}
                  className={`${homeStyles.button} ${homeStyles.primary} ${styles.generateButton}`}
                >
                  <span>生成今日解读</span>
                  <span aria-hidden className={styles.actionArrow} />
                </button>
              </div>
            )}

            {aiError && (
              <div className="anim-curtain ink-panel-quiet p-9 text-center">
                <span aria-hidden className="text-lg text-gold-dim">
                  ◇
                </span>
                <p
                  role="alert"
                  className="font-body italic-soft mt-4 mb-7 text-base text-bone-faint"
                >
                  {aiError}
                </p>
                <button
                  data-small-action="text"
                  type="button"
                  onClick={requestAiInterpretation}
                  className="btn-ink-ghost"
                >
                  重 试
                </button>
              </div>
            )}

            {(aiLoading || aiInterpretation) && (
              <div className="anim-curtain" aria-busy={aiLoading}>
                {/* 卷轴上缘 · 一道金线如轴杆 */}
                <div aria-hidden className="rule-h-gold" />
                <div className="chat-bubble-oracle p-8 md:p-12">
                  {aiInterpretation ? (
                    <InterpretationBody
                      content={aiInterpretation}
                      streaming={aiLoading}
                      cardTerms={[dailyDraw.card.nameCn, dailyDraw.card.name]}
                      showSigil={!aiLoading}
                    />
                  ) : (
                    <div className="flex items-center justify-center gap-4 py-10">
                      <span className="anim-whisper text-gold">✦</span>
                      <span role="status" className="cn-label text-bone-dim">
                        正 在 生 成 解 读
                      </span>
                      <span className="flex gap-2">
                        <span
                          className="anim-whisper h-1 w-1 rounded-full bg-[var(--gold-dim)]"
                          style={{ animationDelay: '0ms' }}
                        />
                        <span
                          className="anim-whisper h-1 w-1 rounded-full bg-[var(--gold-dim)]"
                          style={{ animationDelay: '400ms' }}
                        />
                        <span
                          className="anim-whisper h-1 w-1 rounded-full bg-[var(--gold-dim)]"
                          style={{ animationDelay: '800ms' }}
                        />
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </section>

        {/* ═══ 第三幕 · 札记 ─── 金顶仪式面板 ═══ */}
        <DailyJournal key={activeDateKey} dateKey={activeDateKey} isToday={isToday} />

        {/* ═══ 第四幕 · 轨迹 ─── 十四日星轨时间线 ═══ */}
        <section id="trail" className={`relative z-10 px-6 pb-20 md:px-10 ${styles.section}`}>
          <div className="mx-auto max-w-4xl">
            <div className={`mb-4 flex items-center gap-3 ${styles.sectionHeading}`}>
              <span aria-hidden className={`text-base text-gold-dim ${styles.sectionMark}`}>
                ◆
              </span>
              <h3 className="cn-label text-gold-dim">近 期 轨 迹</h3>
              <div className="rule-h-fade flex-1" />
              <span className="font-heading text-tiny text-bone-whisper">XIV Days</span>
            </div>
            <p
              className={`font-body italic-soft mb-12 text-sm text-bone-whisper ${styles.trailIntro}`}
            >
              过去 {recent.length} 日 · 回看每天的牌面与札记
            </p>

            <HistoryTimeline
              draws={timeline}
              activeDateKey={activeDateKey}
              todayKey={todayKey}
              onSelect={handleSelectDate}
              notedDates={notedDates}
            />

            {/* 图例 */}
            <div
              className={`cn-hint mt-10 flex items-center justify-center gap-6 text-bone-whisper ${styles.legend}`}
            >
              <span className="flex items-center gap-2">
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[var(--gold)]" />正 位
              </span>
              <span className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="h-1.5 w-1.5 rounded-full border border-[var(--mist)]"
                />
                逆 位
              </span>
              <span className="flex items-center gap-2">
                <span aria-hidden className="text-[9px] text-gold-dim">
                  ◆
                </span>
                有 札 记
              </span>
            </div>
          </div>
        </section>

        {/* ─── 终章 ─── */}
        <footer
          className={`relative z-10 flex flex-col items-center gap-5 pb-16 pt-4 ${styles.footer}`}
        >
          <div className="rule-h-gold w-24" />
          <span aria-hidden className="anim-drift text-sm text-gold-dim">
            ✦
          </span>
          <p className="font-heading text-tiny text-bone-whisper">
            <span className="brand-name">{BRAND.name}</span> · 今日一牌
          </p>
        </footer>
      </main>
      <div className={styles.mobileNav}>
        <MainNav activePath="/daily" />
      </div>
    </div>
  );
}

function DailyJournal({ dateKey, isToday }: { dateKey: string; isToday: boolean }) {
  const { note, savedNote, saveState, saveError, loading, updateNote, flush, reload } =
    useDailyNote(dateKey);
  const [legacy, setLegacy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState('');
  useEffect(() => {
    queueMicrotask(() => setLegacy(hasLegacyDailyNotes()));
  }, []);

  return (
    <section
      id="journal"
      className={`relative z-10 px-6 pb-24 md:px-10 md:pb-32 ${styles.section} ${styles.journal}`}
    >
      <div className="mx-auto max-w-2xl">
        <div className={`mb-9 flex items-center gap-3 ${styles.sectionHeading}`}>
          <span aria-hidden className={`text-base text-gold-dim ${styles.sectionMark}`}>
            ◆
          </span>
          <h3 className="cn-label text-gold-dim">心 之 札 记</h3>
          <div className="rule-h-fade flex-1" />
          <span
            className={`cn-hint transition-opacity duration-700 ${
              saveState === 'idle' ? 'opacity-0' : 'opacity-100'
            }`}
            style={{ transitionTimingFunction: 'var(--ease-veil)' }}
            aria-live="polite"
          >
            {saveState === 'saving' ? (
              <span className="text-bone-faint">待 保 存</span>
            ) : saveState === 'saved' ? (
              <span className="text-gold-dim">✦ 已 保 存</span>
            ) : saveState === 'error' ? (
              <span className="text-bone">保 存 失 败</span>
            ) : null}
          </span>
        </div>

        <p className={styles.journalCaption}>{isToday ? '写给今天的自己' : '写给那天的自己'}</p>
        <p className={styles.journalPrompt}>
          {isToday ? '此刻的你，想记录些什么？' : '回想那天，有什么想留下？'}
        </p>
        <div className={`ink-panel-ritual ${styles.journalPanel}`}>
          <textarea
            disabled={loading}
            maxLength={10000}
            value={note}
            onChange={(event) => updateNote(event.target.value)}
            aria-label="每日札记"
            placeholder={isToday ? '在这里，写下你的心声……' : '可补记当日所感。'}
            className="input-ink-bare font-body h-44 w-full resize-none px-8 py-6 text-base leading-loose text-bone"
            spellCheck={false}
          />
        </div>
        {saveError && (
          <div
            role="alert"
            className="mt-4 flex flex-wrap items-center gap-3 text-sm text-bone-dim"
          >
            <p>{saveError} 草稿仍保留在当前会话中，关闭前请重试或复制备份。</p>
            <button
              data-small-action="text"
              type="button"
              onClick={() => (loading ? reload() : flush())}
              className="btn-ink-ghost"
            >
              {loading ? '重试读取' : '重试保存'}
            </button>
          </div>
        )}
        {legacy && (
          <div className="mt-4 text-sm text-bone-dim">
            <p>此设备有旧札记。导入后归当前账号所有；已有云端札记不会被覆盖。</p>
            <button
              data-small-action="text"
              type="button"
              disabled={importing}
              className="btn-ink-ghost"
              onClick={async () => {
                setImporting(true);
                try {
                  const count = await importLegacyDailyNotes();
                  setLegacy(hasLegacyDailyNotes());
                  setImportMessage(
                    `已导入 ${count} 篇札记。${hasLegacyDailyNotes() ? '冲突日期仍保留在此设备。' : ''}`,
                  );
                } catch (error) {
                  setImportMessage(error instanceof Error ? error.message : '导入失败，请重试');
                } finally {
                  setImporting(false);
                }
              }}
            >
              {importing ? '正在导入…' : '将旧札记导入当前账号'}
            </button>
          </div>
        )}
        {importMessage && (
          <p role="status" className="mt-3 text-sm text-bone-dim">
            {importMessage}
          </p>
        )}
        {savedNote?.updatedAt && (
          <p className="cn-hint mt-3.5 text-right text-bone-whisper">
            最 后 一 笔 ·{' '}
            {new Date(savedNote.updatedAt).toLocaleString('zh-CN', {
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </p>
        )}
      </div>
    </section>
  );
}

/* ───────────────────────────────────────────────────────────────
   关键词星尘 · 散落于主卡四周，各自漂移闪烁
   ─────────────────────────────────────────────────────────────── */

interface ScatteredKeywordsProps {
  keywords: ReadonlyArray<string>;
}

function ScatteredKeywords({ keywords }: ScatteredKeywordsProps) {
  return (
    <div
      className={`anim-stagger pointer-events-none absolute inset-0 z-20 ${styles.scatteredKeywords}`}
    >
      {keywords.map((kw, i) => {
        const spot = KEYWORD_SPOTS[i % KEYWORD_SPOTS.length];
        return (
          <span key={`${i}-${kw}`} className={`absolute ${spot.pos}`}>
            <span
              className="anim-drift flex items-center gap-2"
              style={{ animationDelay: spot.driftDelay }}
            >
              <span
                aria-hidden
                className="anim-twinkle text-[10px] text-gold-dim"
                style={{ animationDelay: spot.twinkleDelay }}
              >
                {spot.symbol}
              </span>
              <span className="cn-label text-bone-faint">{kw}</span>
            </span>
          </span>
        );
      })}
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────
   十四日星轨 · 横向时间线：点即一日，悬停浮现牌名
   ─────────────────────────────────────────────────────────────── */

interface HistoryTimelineProps {
  /** 按日期从新到旧排列的每日牌 */
  draws: DailyDraw[];
  activeDateKey: string;
  todayKey: string | null;
  onSelect: (draw: DailyDraw) => void;
  notedDates: Set<string>;
}

function HistoryTimeline({
  draws,
  activeDateKey,
  todayKey,
  onSelect,
  notedDates,
}: HistoryTimelineProps) {
  return (
    <div className="relative">
      {/* 桌面版星轨；手机端采用与轨迹页一致的逐日条目。 */}
      <div
        aria-hidden
        className="hidden md:block absolute left-1 right-1 top-2 h-px -translate-y-1/2 bg-gradient-to-r from-transparent via-[var(--gold-faint)] to-transparent"
      />

      <ol
        aria-label="最近十四日的牌"
        className={`relative md:flex md:items-start md:justify-between md:gap-0 ${styles.timeline}`}
      >
        {draws.map((draw) => {
          const date = parseDateKey(draw.dateKey);
          if (!date) return null;
          const isActive = draw.dateKey === activeDateKey;
          const isThisToday = draw.dateKey === todayKey;
          const noted = notedDates.has(draw.dateKey);

          const dotTone = isActive
            ? draw.isReversed
              ? 'h-3 w-3 border border-[var(--gold)] bg-[var(--gold-faint)] shadow-[0_0_14px_var(--gold-glow)]'
              : 'h-3 w-3 bg-[var(--gold)] shadow-[0_0_14px_var(--gold-glow)]'
            : draw.isReversed
              ? 'h-2 w-2 border border-[var(--mist-faint)] bg-transparent group-hover:border-[var(--mist)]'
              : 'h-2 w-2 bg-[var(--bone-whisper)] group-hover:bg-[var(--bone-dim)]';

          return (
            <li key={draw.dateKey} className="flex justify-center">
              <button
                type="button"
                onClick={() => onSelect(draw)}
                aria-current={isActive ? 'date' : undefined}
                aria-label={`${formatShortDate(date)} · ${draw.card.nameCn} · ${draw.isReversed ? '逆位' : '正位'}${noted ? ' · 有札记' : ''}`}
                className={`group relative flex min-h-11 w-full flex-col items-center px-0.5 md:w-auto ${styles.day}`}
              >
                <span className={styles.mobileDay}>
                  <span className={styles.dayThumbnail} aria-hidden="true">
                    <Image
                      unoptimized
                      src={draw.card.image}
                      alt=""
                      fill
                      sizes="48px"
                      className={draw.isReversed ? styles.reversedThumbnail : undefined}
                    />
                  </span>
                  <span className={styles.dayText}>
                    <time dateTime={draw.dateKey}>
                      {isThisToday ? '今天' : formatShortDate(date)} · {formatHumanWeekday(date)}
                    </time>
                    <span className={styles.dayName}>{draw.card.nameCn}</span>
                    <small>
                      {draw.isReversed ? '逆位' : '正位'} ·{' '}
                      {(draw.isReversed ? draw.card.keywords.reversed : draw.card.keywords.upright)
                        .slice(0, 2)
                        .join(' · ')}
                      {noted ? ' · 有札记' : ''}
                    </small>
                  </span>
                  <span aria-hidden className={styles.dayArrow} />
                </span>
                {/* 悬停浮签 */}
                <span
                  className="hidden md:block cn-hint hairline-gold pointer-events-none absolute bottom-full z-30 mb-2.5 translate-y-1 whitespace-nowrap bg-[var(--ink-veil)] px-3 py-1.5 text-bone-dim opacity-0 transition-all duration-500 group-hover:translate-y-0 group-hover:opacity-100"
                  style={{ transitionTimingFunction: 'var(--ease-veil)' }}
                >
                  {formatShortDate(date)} · {draw.card.nameCn}
                  {draw.isReversed && <span className="text-mist"> 逆</span>}
                  {noted && <span className="text-gold-dim"> ◆</span>}
                </span>

                {/* 星点 */}
                <span
                  className={`relative flex h-4 w-4 items-center justify-center ${styles.desktopDay}`}
                >
                  {isActive && (
                    <span
                      aria-hidden
                      className="anim-glow-pulse absolute inset-0 rounded-full border border-[var(--gold-dim)]"
                    />
                  )}
                  <span
                    className={`rounded-full transition-all duration-500 ${dotTone}`}
                    style={{ transitionTimingFunction: 'var(--ease-ritual)' }}
                  />
                </span>

                {/* 标签 · 固定高度避免跳动 */}
                <span
                  className={`mt-2.5 flex h-9 flex-col items-center gap-0.5 ${styles.desktopDay}`}
                >
                  {isActive ? (
                    <>
                      <span className="cn-hint text-gold">{draw.card.nameCn}</span>
                      <span className="font-heading text-[9px] tracking-[0.2em] text-bone-whisper">
                        {formatShortDate(date)}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="font-heading text-[9px] tracking-[0.2em] text-bone-dim md:hidden">
                        {formatShortDate(date)}
                      </span>
                      {isThisToday ? (
                        <span aria-hidden className="anim-twinkle text-[10px] text-gold">
                          ✦
                        </span>
                      ) : noted ? (
                        <span aria-hidden className="text-[8px] text-gold-dim">
                          ◆
                        </span>
                      ) : null}
                    </>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
