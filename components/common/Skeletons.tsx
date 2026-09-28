/**
 * Skeletons · 路由级与组件级骨架屏
 *
 * 设计原则：
 * - 与 ApiSettings / 解读区同源风格：极细边框 + 暗色脉冲 + 极弱金色扫光
 * - 占位高度 / 间距尽量复刻最终内容形态，避免布局抖动
 * - 不展示 "载入中" 字样，留白即等待，符合仪式感
 */

import { MainNav } from '../layout/MainNav';
import { HistoryPageFrame } from '../history/HistoryPageFrame';
import library from '../cards/CardLibrary.module.css';
import transition from '../layout/PageTransition.module.css';
import history from '../history/HistoryArchive.module.css';
import report from '../reading/ReadingReport.module.css';

interface SkeletonProps {
  className?: string;
  /** 自定义内联 style；常见用例是高度（h-3 不够时） */
  style?: React.CSSProperties;
}

/** 基础骨架原件 · 一根脉冲条 */
export function Skeleton({ className = '', style }: SkeletonProps) {
  return <div className={`skeleton-base ${className}`} style={style} aria-hidden />;
}

/** 卡牌占位 · 3:5 portrait */
function CardSkeleton({ className = '' }: SkeletonProps) {
  return (
    <div className={`relative w-full aspect-[3/5] skeleton-base ${className}`} aria-hidden>
      {/* 内框双线，复刻牌背风格 */}
      <div className="absolute inset-2 hairline" />
      <div className="absolute inset-3.5 hairline-strong" />
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-bone-whisper text-xl">✦</span>
      </div>
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────
   History list · /history
   ─────────────────────────────────────────────────────────────── */

export function HistoryListSkeleton(): React.ReactElement {
  return (
    <HistoryPageFrame loading>
      <HistoryTimelineSkeleton />
    </HistoryPageFrame>
  );
}

/** 仅记录区域显示占位，避免数据返回时整个页面重新入场。 */
export function HistoryTimelineSkeleton(): React.ReactElement {
  return (
    <div role="status" aria-label="正在载入解读记录" className={transition.fade}>
      <div className={history.month}>
        <Skeleton className="w-40 h-6" />
        <Skeleton className="w-24 h-4 ml-auto" />
      </div>
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className={history.entry} aria-hidden="true">
          <Skeleton className="w-36 h-4 mb-3" />
          <div className={history.entryBody}>
            <Skeleton className={history.skeletonCards} />
            <div>
              <Skeleton className="w-full h-5 mb-3" />
              <Skeleton className="w-3/4 h-4 mb-3" />
              <Skeleton className="w-4/5 h-5" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────
   Reading detail · /history/[id]
   ─────────────────────────────────────────────────────────────── */

export function ReadingDetailSkeleton(): React.ReactElement {
  return (
    <div className={report.page} role="status" aria-label="正在载入解读详情">
      <header className={report.header}>
        <Skeleton className="w-16 h-5" />
        <Skeleton className="w-20 h-4" />
      </header>
      <main className={report.main} aria-hidden="true">
        <Skeleton className="w-40 h-3 mb-4" />
        <Skeleton className="w-full h-5 mb-4" />
        <Skeleton className="w-full h-14 mb-6" />
        <Skeleton className="w-full h-11 mb-4" />
        <div className={report.readingCard}>
          <Skeleton className="w-40 h-6 mb-6" />
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="w-full h-4 mb-4" />
          ))}
        </div>
      </main>
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────
   Library · /library
   ─────────────────────────────────────────────────────────────── */

export function LibrarySkeleton(): React.ReactElement {
  return (
    <div className={library.page}>
      <main id="main-content" aria-busy="true" aria-label="正在载入牌典" className={library.main}>
        <header className={`${library.header} ${transition.fade}`}>
          <h1 className={library.pageTitle}>
            牌典
            <span className={library.titleRule} aria-hidden />
          </h1>
          <p className={library.english}>Tarot Library</p>
          <p className={library.intro}>七十八张牌，七十八种看见自己的方式。</p>
          <div className={library.headerFoot} aria-hidden="true">
            <div className={library.collectionButton}>
              <Skeleton className="w-28 h-5" />
            </div>
            <p className={library.headerNote}>
              在牌的光下，
              <br />
              看见更真实的自己。
            </p>
          </div>
        </header>
        <div className={library.filters} aria-hidden="true">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className={library.filterPlaceholder}>
              <Skeleton className="w-16 h-4" />
            </div>
          ))}
        </div>
        <div className={transition.fade} aria-hidden="true">
          <div className={library.sectionHeading}>
            <Skeleton className="w-36 h-7" />
            <Skeleton className="w-20 h-4" />
          </div>
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className={`${library.entry} ${library.entryPlaceholder}`}>
              <Skeleton className={library.thumbnail} />
              <div className={library.entryText}>
                <Skeleton className="w-28 h-6 mb-2" />
                <Skeleton className="w-24 h-4 mb-2" />
                <Skeleton className="w-36 h-4 mb-2" />
                <Skeleton className="w-full h-4 mb-2" />
                <Skeleton className="w-4/5 h-4" />
              </div>
            </div>
          ))}
        </div>
      </main>
      <div className={library.navigation}>
        <MainNav activePath="/library" />
      </div>
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────
   Daily card · /daily
   ─────────────────────────────────────────────────────────────── */

export function DailyCardSkeleton(): React.ReactElement {
  return (
    <div
      aria-busy="true"
      aria-label="正在载入每日一牌"
      className="relative min-h-screen flex flex-col px-5 py-4 md:px-10 md:py-12 anim-fade-in"
    >
      <header className="relative z-20 max-w-5xl w-full mx-auto mb-6 md:mb-12">
        <div className="flex items-center justify-between">
          <Skeleton className="w-20 h-4" />
          <Skeleton className="w-16 h-4" />
        </div>
      </header>

      <main id="main-content" className="relative z-10 flex-1 max-w-5xl w-full mx-auto">
        <div className="hidden md:block text-center mb-14">
          <Skeleton className="w-1.5 h-1.5 rounded-full mx-auto mb-7" />
          <Skeleton className="w-48 h-9 mx-auto mb-4" />
          <Skeleton className="w-32 h-3 mx-auto mb-6" />
          <Skeleton className="w-20 h-px mx-auto mb-6" />
          <Skeleton className="w-56 h-4 mx-auto" />
        </div>

        <div className="flex flex-col items-center mb-8 md:mb-16">
          <div className="w-36 md:w-56 mb-6 md:mb-9">
            <CardSkeleton />
          </div>
          <Skeleton className="w-32 h-7 mb-3" />
          <Skeleton className="w-24 h-3" />
        </div>

        <div className="ink-panel-quiet p-5 md:p-10 max-w-2xl mx-auto">
          <Skeleton className="w-24 h-4 mb-5" />
          <Skeleton className="w-12 h-px mb-6" />
          <Skeleton className="w-full h-4 mb-3" />
          <Skeleton className="w-full h-4 mb-3" />
          <Skeleton className="w-4/5 h-4" />
        </div>
      </main>
    </div>
  );
}
