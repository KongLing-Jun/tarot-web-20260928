'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useIntent } from '@/hooks/useIntent';
import { IntentFeedback } from '@/components/question/IntentFeedback';
import type { useReading } from '@/hooks/useReading';
import { useComposerViewport } from '@/hooks/useComposerViewport';
import type { ApiConfig } from '@/lib/tarot/types';
import { ReadingReport } from './ReadingReport';
import { ReportComposer } from './ReportComposer';
import { FollowUpPanel } from './FollowUpPanel';
import { TarotCardComponent } from '../cards/TarotCard';
import { CelticCrossLayout } from '../cards/CelticCrossLayout';
import styles from './ReadingReport.module.css';
import manual from './ManualReadingReport.module.css';

interface Props {
  intentEnabled?: boolean;
  reading: ReturnType<typeof useReading>;
  config: ApiConfig;
  available: boolean;
  unavailable: boolean;
  onRedraw: () => void;
  onNew: (hasDraft: boolean, question?: string) => void;
}

export function ManualReadingReport({
  reading,
  intentEnabled = false,
  config,
  available,
  unavailable,
  onRedraw,
  onNew,
}: Props) {
  const {
    question,
    spread,
    drawnCards,
    interpretation,
    isInterpreting,
    error,
    notice,
    retryInfo,
    followUps,
    followUpRetries,
    hasInFlightFollowUp,
    cancelRequest,
    startInterpretation,
    askFollowUp,
    revealNextFollowUpCard,
    revealAllFollowUpCards,
    retryFollowUp,
  } = reading;
  const [draft, setDraft] = useState('');
  const intent = useIntent();
  const changeDraft = (text: string) => {
    intent.invalidate();
    setDraft(text);
  };
  const [cardsOpen, setCardsOpen] = useState(true);
  const draftRef = useRef<HTMLTextAreaElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const { keyboardInset, composerHeight } = useComposerViewport(composerRef, 'interpret');
  const followLatest = useRef(true);
  const [showLatest, setShowLatest] = useState(false);
  const main = useRef<HTMLElement>(null);
  const cardTerms = useMemo(
    () => drawnCards.flatMap((d) => [d.card.nameCn, d.card.name]),
    [drawnCards],
  );
  const positionTerms = useMemo(() => spread.positions.map((p) => p.nameCn), [spread]);
  const running =
    isInterpreting || followUps.some((f) => f.status === 'deciding' || f.status === 'interpreting');
  const awaitingReveal = followUps.some((f) => f.status === 'awaiting-reveal');
  const ready = !isInterpreting && !error && Boolean(interpretation) && !hasInFlightFollowUp;
  const pause = () => {
    followLatest.current = false;
  };
  const latest = () => {
    followLatest.current = true;
    setShowLatest(false);
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
  };
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
    let previous = window.scrollY;
    const update = () => {
      const top = window.scrollY;
      if (top < previous) followLatest.current = false;
      previous = top;
      setShowLatest(
        !followLatest.current &&
          document.documentElement.scrollHeight - top - window.innerHeight > 100,
      );
    };
    window.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    if (main.current) observer.observe(main.current);
    return () => {
      window.removeEventListener('scroll', update);
      observer.disconnect();
    };
  }, []);
  useEffect(() => {
    // 初始报告保留顶部阅读位置；追问才跟随最新内容，展开详情或向上滚动后暂停。
    if (followUps.length && followLatest.current)
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
  }, [followUps, composerHeight, keyboardInset]);
  const send = async () => {
    if (!ready || !available || !draft.trim() || intent.busy) return;
    if (!intentEnabled) {
      followLatest.current = true;
      askFollowUp(draft.trim(), config);
      setDraft('');
      return;
    }
    const result = await intent.analyze({
      question: draft.trim(),
      readingId: reading.readingId ?? undefined,
    });
    if (!result || result.plan.mode === 'clarify') return;
    if (result.candidate.turnAction === 'switch-topic') {
      intent.reset();
      onNew(false, draft.trim());
      return;
    }
    followLatest.current = true;
    askFollowUp(draft.trim(), config, {
      intentId: result.id,
      direct: result.plan.reuseExistingCards,
    });
    intent.reset();
    setDraft('');
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send();
    }
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link
          data-small-action="icon"
          data-small-icon="back"
          href="/"
          aria-label="返回首页"
          className={styles.back}
        >
          <span aria-hidden="true">〈</span>
        </Link>
        <div className={styles.headerActions}>
          <Link data-small-action="text" href="/history">
            轨迹
          </Link>
          <button
            data-small-action="text"
            type="button"
            onClick={() => {
              intent.reset();
              onNew(Boolean(draft.trim()));
            }}
          >
            ＋新问题
          </button>
        </div>
      </header>
      <main
        ref={main}
        id="main-content"
        className={`${styles.main} ${manual.main}`}
        style={composerHeight ? { paddingBottom: composerHeight + keyboardInset + 16 } : undefined}
      >
        <div className={`${styles.messages} ${manual.messages}`}>
          <p className={styles.question}>
            <span aria-hidden="true">✦</span>正在看 · {question}
          </p>
          {isInterpreting && <p className={manual.mode}>手动选阵 · 已揭牌</p>}
          <details
            open={cardsOpen}
            className={`${styles.spread} ${manual.spread}`}
            onToggle={(event) => setCardsOpen(event.currentTarget.open)}
          >
            <summary onClick={pause}>
              <span>
                {spread.nameCn} <small>{cardsOpen ? '· 收起牌面 ⌃' : '· 展开牌面 ⌄'}</small>
              </span>
              <span className={manual.thumbs} aria-hidden="true">
                {drawnCards.slice(0, 3).map((d) => (
                  <Image
                    key={d.position.id}
                    src="/brand/spread-theme/card-back.webp"
                    alt=""
                    width={28}
                    height={42}
                  />
                ))}
              </span>
            </summary>
            <div className={styles.spreadBody}>
              {spread.id === 'celtic-cross' ? (
                <CelticCrossLayout
                  drawnCards={drawnCards}
                  revealedCount={drawnCards.length}
                  onReveal={() => {}}
                />
              ) : (
                <div className={styles.cards}>
                  {drawnCards.map((d) => (
                    <div key={d.position.id}>
                      <p className={manual.position}>{d.position.nameCn}</p>
                      <TarotCardComponent
                        card={d.card}
                        isReversed={d.isReversed}
                        isRevealed
                        size="sm"
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </details>
          <ReadingReport
            content={interpretation}
            running={isInterpreting}
            error={error}
            notice={notice}
            retry={retryInfo}
            hasCards={drawnCards.length > 0}
            cardTerms={cardTerms}
            positionTerms={positionTerms}
            onDetailInteraction={pause}
          />
          {!isInterpreting && !hasInFlightFollowUp && !intent.busy && (
            <div className={styles.reportActions}>
              <button
                data-small-action="text"
                type="button"
                disabled={!available}
                onClick={() => startInterpretation(config)}
                aria-label={error ? '重试解读（保留原牌）' : '重新解读（保留原牌）'}
              >
                <span className={styles.actionIcon} aria-hidden="true">
                  ↻
                </span>
                <span>
                  {error ? '重试解读' : '重新解读'}
                  <small>保留原牌</small>
                </span>
              </button>
              <button
                data-small-action="text"
                type="button"
                onClick={() => {
                  intent.reset();
                  onRedraw();
                }}
              >
                <span className={styles.actionIcon} aria-hidden="true">
                  ⤨
                </span>
                重新抽牌
              </button>
            </div>
          )}
          {followUps.map((fu) => (
            <FollowUpPanel
              key={fu.id}
              followUp={fu}
              apiConfig={config}
              baseCardTerms={cardTerms}
              basePositionTerms={positionTerms}
              retry={followUpRetries[fu.id] ?? null}
              onRevealNext={revealNextFollowUpCard}
              onRevealAll={revealAllFollowUpCards}
              onRetry={(id, apiConfig) => {
                intent.reset();
                retryFollowUp(id, apiConfig);
              }}
              onDetailInteraction={pause}
            />
          ))}
        </div>
      </main>
      <ReportComposer
        draft={draft}
        onChange={changeDraft}
        onSend={send}
        onKeyDown={onKeyDown}
        onCancel={() => {
          intent.reset();
          cancelRequest();
        }}
        draftRef={draftRef}
        composerRef={composerRef}
        canSend={ready && available}
        running={running || intent.busy}
        feedback={<IntentFeedback {...intent} />}
        ready={ready}
        unavailable={unavailable}
        keyboardInset={keyboardInset}
        showLatest={showLatest}
        onLatest={latest}
        activePath="/reading"
        inputLabel="追问内容"
        placeholder={
          awaitingReveal
            ? '先揭开补牌，再继续解读…'
            : !running && !ready
              ? '完成解读后可追问…'
              : undefined
        }
      />
    </div>
  );
}
