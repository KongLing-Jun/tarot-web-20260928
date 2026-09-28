'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { parseReadingContent } from '@/lib/interpretation';
import { InterpretationBody } from './Interpretation';
import { ReadingLoading, GenerationInfo } from './ReadingLoading';
import type { RetryState } from '@/lib/api/stream-client';
import styles from './ReadingReport.module.css';

interface Props {
  content: string;
  running: boolean;
  error: string | null;
  notice?: string | null;
  retry?: RetryState | null;
  hasCards: boolean;
  cardTerms: string[];
  positionTerms: string[];
  onDetailInteraction: () => void;
}

export function ReadingReport({
  content,
  running,
  error,
  notice,
  retry,
  hasCards,
  cardTerms,
  positionTerms,
  onDetailInteraction,
}: Props) {
  const { sections, answer, thinking } = parseReadingContent(content, running);
  const [chapter, setChapter] = useState(0);
  const [expanded, setExpanded] = useState([true, true]);
  const [wasRunning, setWasRunning] = useState(running);
  const gesture = useRef<{ x: number; y: number } | null>(null);
  const id = useId();
  if (wasRunning !== running) {
    setWasRunning(running);
    if (running) {
      setChapter(0);
      setExpanded([true, true]);
    }
  }
  const select = (index: number) => {
    onDetailInteraction();
    setChapter(index);
  };
  const render = (text: string) => (
    <InterpretationBody content={text} cardTerms={cardTerms} positionTerms={positionTerms} />
  );
  const chapters = [sections?.core ?? '', sections?.actions ?? ''];
  const labels = ['事情怎么看', '可以怎么做'];
  const visibleChapters = chapters
    .map((text, index) => ({ text, index }))
    .filter(({ text }) => text.trim());
  const activeChapter =
    visibleChapters.find(({ index }) => index === chapter) ?? visibleChapters[0];
  const activeIndex = activeChapter?.index ?? 0;
  const hasTabs = visibleChapters.length > 1;
  const hasAnswer = sections
    ? Boolean(sections.core.trim() || sections.actions?.trim())
    : Boolean(answer.trim());
  const waiting = running && !error && !hasAnswer;

  return (
    <div className={styles.report}>
      {waiting && (
        <ReadingLoading
          hasCards={hasCards}
          thinking={thinking}
          retry={retry}
          onDetailInteraction={onDetailInteraction}
        />
      )}
      {!waiting && sections && answer && (
        <>
          {activeChapter && (
            <div className={styles.chapterEyebrow}>
              <span aria-hidden="true">✦</span>
              {hasTabs ? '本次解读 · 两个视角' : '本次解读'}
              <span aria-hidden="true">✦</span>
            </div>
          )}
          {hasTabs && (
            <div className={styles.tabs} role="tablist" aria-label="解读章节">
              {labels.map((label, index) => (
                <button
                  data-small-action="tab"
                  key={label}
                  type="button"
                  role="tab"
                  id={`${id}-tab-${index}`}
                  aria-controls={`${id}-panel`}
                  aria-selected={chapter === index}
                  tabIndex={chapter === index ? 0 : -1}
                  onClick={() => select(index)}
                  onKeyDown={(event) => {
                    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                    event.preventDefault();
                    const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1 - chapter;
                    select(next);
                    document.getElementById(`${id}-tab-${next}`)?.focus();
                  }}
                >
                  <span aria-hidden="true">{index ? '☾' : '☀'}</span>
                  <small>0{index + 1}</small>
                  {label}
                </button>
              ))}
            </div>
          )}
          {activeChapter && (
            <section
              id={`${id}-panel`}
              role={hasTabs ? 'tabpanel' : undefined}
              aria-labelledby={hasTabs ? `${id}-tab-${activeIndex}` : `${id}-heading`}
              className={styles.readingCard}
              onTouchStart={(event) => {
                const touch = event.touches[0];
                gesture.current = { x: touch.clientX, y: touch.clientY };
              }}
              onTouchEnd={(event) => {
                const start = gesture.current;
                gesture.current = null;
                if (!start || !hasTabs) return;
                const touch = event.changedTouches[0],
                  dx = touch.clientX - start.x,
                  dy = touch.clientY - start.y;
                if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.5) select(dx < 0 ? 1 : 0);
              }}
            >
              <h2 id={`${id}-heading`}>{activeIndex ? '把下一步，交还给自己' : '事情怎么看'}</h2>
              {hasTabs && <p className={styles.chapterNumber}>0{activeIndex + 1} / 02</p>}
              <ReportText
                key={activeIndex}
                id={`${id}-text-${activeIndex}`}
                text={activeChapter.text}
                expanded={expanded[activeIndex]}
                onToggle={() => {
                  onDetailInteraction();
                  setExpanded((values) =>
                    values.map((value, index) => (index === activeIndex ? !value : value)),
                  );
                }}
              >
                {render(activeChapter.text)}
              </ReportText>
            </section>
          )}
          {hasTabs && (
            <div className={styles.pager}>
              <button data-small-action="text" type="button" onClick={() => select(1 - chapter)}>
                {chapter ? '← 事情怎么看' : '可以怎么做 →'}
              </button>
              <span>{chapter + 1} / 2</span>
            </div>
          )}
          {sections.cards?.trim() && (
            <ReportDisclosure title="牌义依据" onOpen={onDetailInteraction}>
              {render(sections.cards)}
            </ReportDisclosure>
          )}
        </>
      )}
      {!waiting && !sections && answer && (
        <section className={styles.readingCard}>
          <h2>本次解读</h2>
          <div className={styles.prose}>{render(answer)}</div>
        </section>
      )}
      {error && (
        <div
          className={answer ? styles.errorNote : `${styles.readingCard} ${styles.errorCard}`}
          role="alert"
        >
          {!answer && (
            <>
              <span aria-hidden="true" className={styles.errorSymbol}>
                ☾
              </span>
              <h2>解读暂未完成</h2>
            </>
          )}
          <p>{error}</p>
          <small>
            {answer
              ? '已保留生成的内容，可以重新解读。'
              : hasCards
                ? '本次牌面已保留，不需要重新抽牌。'
                : '尚未完成选阵与抽牌，可以重试。'}
          </small>
        </div>
      )}
      {running && !waiting && !error && (
        <p role="status" className={styles.pending}>
          {retry
            ? `连接中断，正在重试（第 ${retry.attempt} / ${retry.max} 次）`
            : hasCards
              ? '正在生成解读…'
              : '正在选择牌阵…'}
        </p>
      )}
      {notice && !running && (
        <p role="status" className={styles.errorNote}>
          {notice}
        </p>
      )}
      {thinking && running && !waiting && (
        <GenerationInfo
          hasCards={hasCards}
          thinking={thinking}
          retry={retry}
          onDetailInteraction={onDetailInteraction}
        />
      )}
    </div>
  );
}

function ReportText({
  id,
  text,
  expanded,
  onToggle,
  children,
}: {
  id: string;
  text: string;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const body = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(text.length > 80);
  useEffect(() => {
    const element = body.current;
    if (!element || expanded) return;
    // 同时观察正文与可视容器，换行、字体加载、流式追加都能更新展开入口。
    const observer = new ResizeObserver(() =>
      setOverflows(element.scrollHeight > element.clientHeight + 1),
    );
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    return () => observer.disconnect();
  }, [expanded, text]);
  return (
    <>
      <div ref={body} className={`${styles.prose} ${!expanded ? styles.excerpt : ''}`} id={id}>
        {children}
      </div>
      {(overflows || expanded) && (
        <button
          data-small-action="text"
          type="button"
          className={styles.expand}
          aria-expanded={expanded}
          aria-controls={id}
          onClick={onToggle}
        >
          {expanded ? '收起本段 ⌃' : '展开本段 ⌄'}
        </button>
      )}
    </>
  );
}

function ReportDisclosure({
  title,
  onOpen,
  children,
}: {
  title: string;
  onOpen: () => void;
  children: ReactNode;
}) {
  return (
    <details
      className={styles.disclosure}
      onToggle={(event) => {
        if (event.currentTarget.open) onOpen();
      }}
    >
      <summary onClick={onOpen}>
        <span>{title}</span>
        <span aria-hidden="true">›</span>
      </summary>
      <div className={styles.prose}>{children}</div>
    </details>
  );
}
