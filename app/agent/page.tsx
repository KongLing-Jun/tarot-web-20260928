'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { getReadingForResume } from '@/lib/readingResume';

import { TarotCardComponent } from '@/components/cards/TarotCard';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { CelticCrossLayout } from '@/components/cards/CelticCrossLayout';
import { useAgentChatSession } from '@/components/session/AgentChatSession';
import { useIntent } from '@/hooks/useIntent';
import { IntentFeedback } from '@/components/question/IntentFeedback';
import { useApiConfig } from '@/hooks/useApiConfig';
import { appendDraft } from '@/components/question/DraftAids';
import { QuestionWelcome } from '@/components/question/QuestionWelcome';
import { ReadingReport } from '@/components/reading/ReadingReport';
import { ReportComposer } from '@/components/reading/ReportComposer';
import { AgentPageSkeleton } from '@/components/question/AgentPageSkeleton';
import transition from '@/components/layout/PageTransition.module.css';
import report from '@/components/reading/ReadingReport.module.css';
import manual from '@/components/reading/ManualReadingReport.module.css';
import type { AgentMessage, ChatMessage, FollowUpMessage } from '@/hooks/useAgentChat';
import type { DrawnCard, Spread } from '@/lib/tarot/types';

function isAwayFromLatest() {
  // 容忍底部的像素取整误差，避免按钮闪现。
  return document.documentElement.scrollHeight - window.scrollY - window.innerHeight > 8;
}

export default function AgentPage() {
  return (
    <Suspense fallback={<AgentPageSkeleton />}>
      <AgentRoute />
    </Suspense>
  );
}

function AgentRoute() {
  const params = useSearchParams();
  const readingId = params.get('readingId');
  return (
    <AgentConversation
      key={readingId ?? 'new'}
      readingId={readingId}
      startNew={params.get('new') === '1'}
    />
  );
}

function AgentConversation({
  readingId,
  startNew,
}: {
  readingId: string | null;
  startNew: boolean;
}) {
  const router = useRouter();
  const {
    messages,
    isRunning,
    sendQuestion,
    askFollowUp,
    regenerateAgentMessage,
    regenerateFollowUp,
    redrawAgentMessage,
    cancel,
    reset,
    restoreReading,
    hasReading,
    draft,
    setDraft,
    directDraft,
    setDirectDraft,
  } = useAgentChatSession();
  const [resumeState, setResumeState] = useState<'loading' | 'ready' | 'error'>(
    readingId !== null && !hasReading(readingId) ? 'loading' : 'ready',
  );
  const [resumeError, setResumeError] = useState('');
  const [resumeAttempt, setResumeAttempt] = useState(0);
  useEffect(() => {
    if (readingId === null || hasReading(readingId)) return;
    let active = true;
    getReadingForResume(readingId)
      .then(({ reading, completion }) => {
        if (!active) return;
        restoreReading(reading, completion);
        setResumeState('ready');
      })
      .catch((error) => {
        if (!active) return;
        setResumeError(error instanceof Error ? error.message : '读取失败');
        setResumeState('error');
      });
    return () => {
      active = false;
    };
  }, [readingId, resumeAttempt, restoreReading, hasReading]);
  const { config, isLoaded, canUseApi, intentEnabled } = useApiConfig();
  // 返回时已有牌面直接展示；本次停留期间新抽到的牌仍播放揭牌动画。
  const [existingCards] = useState(
    () =>
      new Set(
        messages.flatMap((message) => {
          if (message.role !== 'agent') return [];
          return [
            ...(message.drawnCards.length ? [message.id] : []),
            ...message.followUps.filter((fu) => fu.additionalCards.length).map((fu) => fu.id),
          ];
        }),
      ),
  );
  const draftRef = useRef<HTMLTextAreaElement>(null);
  const [redrawTarget, setRedrawTarget] = useState<string | null>(null);
  const [showLatest, setShowLatest] = useState(false);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const [composerHeight, setComposerHeight] = useState(0);
  const composerRef = useRef<HTMLDivElement>(null);
  const followLatestRef = useRef(true);
  const previousScrollRef = useRef(0);
  const hasConversation = messages.length > 0;
  const [confirmNew, setConfirmNew] = useState(false);
  const handledNew = useRef(false);
  useEffect(() => {
    if (!startNew) {
      handledNew.current = false;
      return;
    }
    if (handledNew.current) return;
    handledNew.current = true;
    // URL 的一次性新建意图需同步全局会话，并保护未发送草稿。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (isRunning || draft.trim()) setConfirmNew(true);
    else reset();
    router.replace('/agent');
  }, [startNew, isRunning, draft, reset, router]);

  // 滚到包含输入区留白的文档底部，避免最后一行被固定输入框遮挡。
  useEffect(() => {
    if (messages.length > 0 && followLatestRef.current) {
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
    }
  }, [messages, composerHeight, keyboardInset]);

  useEffect(() => {
    const onScroll = () => {
      const scrollTop = window.scrollY;
      // 上滑立即解除跟随；内容增长不会被误判为用户上滑。
      if (scrollTop < previousScrollRef.current) followLatestRef.current = false;
      previousScrollRef.current = scrollTop;
      setShowLatest(!followLatestRef.current && isAwayFromLatest());
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    const viewport = window.visualViewport;
    const onViewport = () => {
      setKeyboardInset(
        viewport ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) : 0,
      );
      setShowLatest(!followLatestRef.current && isAwayFromLatest());
    };
    window.addEventListener('resize', onViewport);
    viewport?.addEventListener('resize', onViewport);
    viewport?.addEventListener('scroll', onViewport);
    const observer = new ResizeObserver(() => {
      setComposerHeight(composerRef.current?.getBoundingClientRect().height ?? 0);
      setShowLatest(!followLatestRef.current && isAwayFromLatest());
    });
    if (composerRef.current) observer.observe(composerRef.current);
    observer.observe(document.documentElement);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onViewport);
      viewport?.removeEventListener('resize', onViewport);
      viewport?.removeEventListener('scroll', onViewport);
      observer.disconnect();
    };
  }, [hasConversation, resumeState]);

  const goToLatest = () => {
    followLatestRef.current = true;
    setShowLatest(false);
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
  };

  const pauseForDetails = () => {
    followLatestRef.current = false;
    setShowLatest(isAwayFromLatest());
  };

  const latestAgent = [...messages].reverse().find((message) => message.role === 'agent');
  const canSend =
    resumeState === 'ready' && canUseApi && (!hasConversation || latestAgent?.status === 'done');

  const intent = useIntent();
  const resetIntent = intent.reset;
  useEffect(() => {
    resetIntent();
  }, [readingId, startNew, resetIntent]);
  const changeDraft = (text: string) => {
    intent.invalidate();
    setDraft(text);
  };
  const handleSend = async (): Promise<void> => {
    const text = draft.trim();
    if (!text || isRunning || intent.busy || !canSend) return;
    const currentAgent = [...messages].reverse().find((m) => m.role === 'agent');
    if (!intentEnabled) {
      goToLatest();
      if (currentAgent?.status === 'done')
        askFollowUp(text, config, directDraft ? { direct: true } : undefined);
      else sendQuestion(text, config);
      setDraft('');
      setDirectDraft(false);
      return;
    }
    let result = await intent.analyze({
      question: text,
      readingId: currentAgent?.readingId ?? undefined,
    });
    const newTopic = result?.candidate.turnAction === 'switch-topic';
    if (newTopic && currentAgent?.readingId) result = await intent.analyze({ question: text });
    if (!result || result.plan.mode === 'clarify') return;
    goToLatest();
    // 有首轮解读后，输入视为追问；否则视为首轮提问
    const lastAgent = [...messages].reverse().find((m) => m.role === 'agent');
    if (lastAgent && lastAgent.role === 'agent' && lastAgent.status === 'done') {
      if (newTopic) {
        sendQuestion(text, config, { intentId: result.id });
      } else
        askFollowUp(text, config, {
          direct: directDraft || result.plan.reuseExistingCards,
          intentId: result.id,
        });
    } else {
      sendQuestion(text, config, { intentId: result.id });
    }
    setDraft('');
    setDirectDraft(false);
    intent.reset();
  };

  // 辅助内容只填草稿，以用户最终编辑的正文为准。
  const handleSuggestion = (question: string): void => {
    if (isRunning) return;
    changeDraft(appendDraft(draft, question));
    draftRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    // Enter 发送，Shift+Enter 换行
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSend();
    }
  };

  const beginNew = () => {
    intent.reset();
    reset();
    setDraft('');
    setDirectDraft(false);
    setConfirmNew(false);
    window.scrollTo({ top: 0, behavior: 'instant' });
    if (readingId !== null) router.replace('/agent');
  };
  const newDialog = (
    <ConfirmDialog
      isOpen={confirmNew}
      title="开始新对话"
      confirmLabel="开始新对话"
      message={
        isRunning
          ? '当前解读还在生成。开始新对话将停止生成，已保存的记录仍可在轨迹中查看。'
          : '还有未发送的草稿。开始新对话将清空这份草稿，已保存的解读仍可在轨迹中查看。'
      }
      onCancel={() => setConfirmNew(false)}
      onConfirm={beginNew}
    />
  );

  if (resumeState === 'ready' && !hasConversation) {
    return (
      <>
        <QuestionWelcome
          draft={draft}
          onChange={changeDraft}
          onPick={handleSuggestion}
          onSend={handleSend}
          canSend={canSend && !isRunning}
          unavailable={isLoaded && !canUseApi}
          busy={isRunning || intent.busy}
          feedback={
            <>
              <IntentFeedback {...intent} />
              {intent.busy && (
                <button type="button" data-small-action="text" onClick={intent.reset}>
                  取消识别
                </button>
              )}
            </>
          }
          draftRef={draftRef}
          composerRef={composerRef}
          keyboardInset={keyboardInset}
        />
        {newDialog}
      </>
    );
  }

  return (
    <div className={report.page}>
      {/* ─── 漂浮符印 · 全局氛围层 ─── */}
      <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none" aria-hidden>
        <span
          className="scatter-symbol text-2xl top-[16%] left-[5%] anim-drift"
          style={{ animationDelay: '2s' }}
        >
          ✧
        </span>
        <span
          className="scatter-symbol text-3xl top-[62%] right-[4%] anim-drift"
          style={{ animationDelay: '5s' }}
        >
          ☾
        </span>
        <span
          className="scatter-symbol text-lg top-[38%] right-[14%] anim-twinkle"
          style={{ animationDelay: '1s' }}
        >
          ⋆
        </span>
        <span className="scatter-symbol text-xl bottom-[16%] left-[20%] anim-whisper">⊹</span>
        <span
          className="scatter-symbol text-sm top-[8%] right-[38%] anim-twinkle"
          style={{ animationDelay: '2.6s' }}
        >
          ✦
        </span>
      </div>

      <header className={`${report.header} ${transition.fade}`}>
        <Link
          data-small-action="icon"
          data-small-icon="back"
          href="/"
          aria-label="返回首页"
          className={report.back}
        >
          <span aria-hidden="true">〈</span>
        </Link>
        <div className={report.headerActions}>
          <Link data-small-action="text" href="/history">
            轨迹
          </Link>
          <button
            data-small-action="text"
            type="button"
            onClick={() => {
              if (isRunning || draft.trim()) setConfirmNew(true);
              else beginNew();
            }}
          >
            ＋新对话
          </button>
        </div>
      </header>

      {/* ─── 对话区 ─── */}
      <main
        id="main-content"
        className={`${report.main} ${transition.fade}`}
        style={composerHeight ? { paddingBottom: composerHeight + keyboardInset } : undefined}
      >
        <div className={report.messages}>
          {resumeState === 'loading' && (
            <p role="status" className="text-bone">
              正在恢复这件事的原问题、牌面和追问…
            </p>
          )}
          {resumeState === 'error' && (
            <div className="space-y-4 text-bone">
              <p role="alert">{resumeError}</p>
              <button
                data-small-action="text"
                className="btn-ink px-4 py-2"
                onClick={() => {
                  setResumeState('loading');
                  setResumeAttempt((value) => value + 1);
                }}
              >
                重试读取
              </button>
              <Link data-small-action="text" href="/history" className="ml-4 text-gold">
                返回轨迹
              </Link>
            </div>
          )}

          {messages.map((msg) => (
            <MessageBubble
              key={msg.id}
              message={
                msg.role === 'agent'
                  ? {
                      ...msg,
                      restored: msg.restored || existingCards.has(msg.id),
                      followUps: msg.followUps.map((fu) => ({
                        ...fu,
                        restored: fu.restored || existingCards.has(fu.id),
                      })),
                    }
                  : msg
              }
              isRunning={isRunning || intent.busy}
              canUseApi={canUseApi}
              onDetailInteraction={pauseForDetails}
              onRegenerateAgent={(agentId) => {
                regenerateAgentMessage(agentId, config);
              }}
              onRedraw={setRedrawTarget}
              onRegenerateFollowUp={(agentId, followUpId) => {
                regenerateFollowUp(agentId, followUpId, config);
              }}
            />
          ))}
        </div>
      </main>

      <ReportComposer
        draft={draft}
        onChange={(value) => {
          changeDraft(value);
          if (!value.trim()) setDirectDraft(false);
        }}
        onSend={handleSend}
        onKeyDown={handleKeyDown}
        onCancel={() => {
          intent.reset();
          cancel();
        }}
        draftRef={draftRef}
        composerRef={composerRef}
        canSend={canSend}
        running={isRunning || intent.busy}
        feedback={
          <>
            <IntentFeedback {...intent} />
            {intent.busy && (
              <button type="button" data-small-action="text" onClick={intent.reset}>
                取消识别
              </button>
            )}
          </>
        }
        ready={resumeState === 'ready'}
        unavailable={isLoaded && !canUseApi}
        keyboardInset={keyboardInset}
        showLatest={hasConversation && showLatest}
        onLatest={goToLatest}
      />
      {newDialog}
      <ConfirmDialog
        isOpen={redrawTarget !== null}
        title="重新抽牌"
        message="将为同一问题重新选择牌阵并抽出新牌，原来的牌与解读仍保留。只想换一种解释，请取消并选择「重新解读（保留原牌）」。"
        confirmLabel="确认重新抽牌"
        onCancel={() => setRedrawTarget(null)}
        onConfirm={() => {
          if (redrawTarget) {
            goToLatest();
            redrawAgentMessage(redrawTarget, config);
          }
          setRedrawTarget(null);
        }}
      />
    </div>
  );
}

// ─── 消息气泡 ─────────────────────────────────────────────

interface MessageBubbleProps {
  message: ChatMessage;
  isRunning: boolean;
  canUseApi: boolean;
  onRegenerateAgent: (agentId: string) => void;
  onRedraw: (agentId: string) => void;
  onRegenerateFollowUp: (agentId: string, followUpId: string) => void;
  onDetailInteraction: () => void;
}

function MessageBubble({
  message,
  isRunning,
  canUseApi,
  onRegenerateAgent,
  onRedraw,
  onRegenerateFollowUp,
  onDetailInteraction,
}: MessageBubbleProps) {
  if (message.role === 'user') {
    return (
      <p className={report.question}>
        <span aria-hidden="true">✦</span>正在聊 · {message.content}
      </p>
    );
  }

  return (
    <AgentBubble
      message={message}
      isRunning={isRunning}
      canUseApi={canUseApi}
      onRegenerate={onRegenerateAgent}
      onRedraw={onRedraw}
      onRegenerateFollowUp={onRegenerateFollowUp}
      onDetailInteraction={onDetailInteraction}
    />
  );
}

// ─── Agent 气泡 · 神谕回应 ────────────────────────────────

interface AgentBubbleProps {
  message: AgentMessage;
  isRunning: boolean;
  canUseApi: boolean;
  onRegenerate: (agentId: string) => void;
  onRedraw: (agentId: string) => void;
  onRegenerateFollowUp: (agentId: string, followUpId: string) => void;
  onDetailInteraction: () => void;
}

function AgentBubble({
  message,
  isRunning,
  canUseApi,
  onRegenerate,
  onRedraw,
  onRegenerateFollowUp,
  onDetailInteraction,
}: AgentBubbleProps) {
  // 术语提取必须在组件顶层无条件调用（rules-of-hooks）
  const cardTerms = useCardTerms(message.drawnCards);
  const positionTerms = usePositionTerms(message.spread);
  const canRegenerate =
    !isRunning && canUseApi && (message.status === 'done' || message.status === 'error');

  return (
    <div>
      <div>
        {(message.spread || message.drawnCards.length > 0) && (
          <details
            className={report.spread}
            onToggle={(event) => {
              if (event.currentTarget.open) onDetailInteraction();
            }}
          >
            <summary onClick={onDetailInteraction}>
              <span>
                {message.spread?.nameCn ?? '本次牌面'} <small>· 查看牌阵 ⌄</small>
              </span>
              <span className={report.thumbs} aria-hidden="true">
                {message.drawnCards.slice(0, 3).map((drawn, index) => (
                  <span key={drawn.position.id}>{['☀', '☾', '✧'][index]}</span>
                ))}
              </span>
            </summary>
            <div className={report.spreadBody}>
              {message.spreadReason && <p>{message.spreadReason}</p>}
              {message.drawnCards.length > 0 &&
                (message.spread?.id === 'celtic-cross' ? (
                  <CelticCrossLayout
                    drawnCards={message.drawnCards}
                    revealedCount={message.drawnCards.length}
                    onReveal={() => {}}
                  />
                ) : (
                  <div className={report.cards}>
                    {message.drawnCards.map((drawn, index) => (
                      <CardAutoReveal
                        key={drawn.position.id}
                        drawn={drawn}
                        delay={index * 220}
                        initiallyRevealed={message.restored}
                      />
                    ))}
                  </div>
                ))}
            </div>
          </details>
        )}
        <ReadingReport
          content={message.content}
          running={message.status === 'running'}
          error={message.error}
          notice={message.notice}
          retry={message.retry}
          hasCards={message.drawnCards.length > 0}
          cardTerms={cardTerms}
          positionTerms={positionTerms}
          onDetailInteraction={onDetailInteraction}
        />
        {canRegenerate && (
          <div className={report.reportActions}>
            <button
              data-small-action="text"
              type="button"
              onClick={() => onRegenerate(message.id)}
              aria-label={message.drawnCards.length ? '重新解读（保留原牌）' : '重试选阵与抽牌'}
            >
              <span aria-hidden="true" className={report.actionIcon}>
                ↻
              </span>
              <span>
                {message.drawnCards.length ? (
                  <>
                    {message.status === 'error' ? '重试解读' : '重新解读'}
                    <small>保留原牌</small>
                  </>
                ) : (
                  '重试选阵与抽牌'
                )}
              </span>
            </button>
            {message.drawnCards.length > 0 && (
              <button data-small-action="text" type="button" onClick={() => onRedraw(message.id)}>
                <span aria-hidden="true" className={report.actionIcon}>
                  ⤨
                </span>
                重新抽牌
              </button>
            )}
          </div>
        )}

        {/* 追问列表 */}
        {message.followUps.map((fu) => (
          <FollowUpBlock
            key={fu.id}
            agentId={message.id}
            followUp={fu}
            baseCardTerms={cardTerms}
            basePositionTerms={positionTerms}
            hasBaseCards={message.drawnCards.length > 0}
            isRunning={isRunning}
            canUseApi={canUseApi}
            onRegenerate={onRegenerateFollowUp}
            onDetailInteraction={onDetailInteraction}
          />
        ))}
      </div>
    </div>
  );
}

// ─── 自动翻牌（挂载后延时揭示 · 悬浮牌） ──────────────────

function CardAutoReveal({
  drawn,
  delay,
  initiallyRevealed = false,
}: {
  drawn: DrawnCard;
  delay: number;
  initiallyRevealed?: boolean;
}) {
  const [revealed, setRevealed] = useState(initiallyRevealed);
  useEffect(() => {
    if (initiallyRevealed) return;
    const t = setTimeout(() => setRevealed(true), delay + 150);
    return () => clearTimeout(t);
  }, [delay, initiallyRevealed]);

  return (
    <div className="flex flex-col items-center gap-4">
      <span className="cn-label text-bone-faint">{drawn.position.nameCn}</span>
      <div className="float-card">
        <TarotCardComponent
          card={drawn.card}
          isReversed={drawn.isReversed}
          isRevealed={revealed}
          size="sm"
          enableInteractions={false}
        />
      </div>
      {/* 牌名 · 揭示后浮现 */}
      <div
        className={`text-center transition-all duration-1000 ${
          revealed ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
        }`}
        style={{ transitionTimingFunction: 'var(--ease-veil)' }}
      >
        <span className="font-display text-sm text-gold tracking-[0.18em]">
          {drawn.card.nameCn}
        </span>
        {drawn.isReversed && (
          <span className="text-tiny font-heading text-bone-faint block mt-1.5">逆 位</span>
        )}
      </div>
    </div>
  );
}

// ─── 追问块 ───────────────────────────────────────────────

interface FollowUpBlockProps {
  agentId: string;
  followUp: FollowUpMessage;
  baseCardTerms: string[];
  basePositionTerms: string[];
  hasBaseCards: boolean;
  isRunning: boolean;
  canUseApi: boolean;
  onRegenerate: (agentId: string, followUpId: string) => void;
  onDetailInteraction: () => void;
}

function FollowUpBlock({
  agentId,
  followUp: fu,
  baseCardTerms,
  basePositionTerms,
  hasBaseCards,
  isRunning,
  canUseApi,
  onRegenerate,
  onDetailInteraction,
}: FollowUpBlockProps) {
  const cardTerms = useMemo(
    () => [...baseCardTerms, ...fu.additionalCards.flatMap((d) => [d.card.nameCn, d.card.name])],
    [baseCardTerms, fu.additionalCards],
  );
  const positionTerms = useMemo(
    () => [...basePositionTerms, ...fu.additionalCards.map((d) => d.position.nameCn)],
    [basePositionTerms, fu.additionalCards],
  );
  const deciding = fu.status === 'running' && !fu.decision && !fu.interpretation;
  const canRegenerate = !isRunning && canUseApi && (fu.status === 'done' || fu.status === 'error');

  return (
    <section className={manual.followUp} aria-label="本次追问">
      <p className={report.question}>
        <span aria-hidden="true">✦</span>继续聊 · {fu.question}
      </p>
      {deciding && (
        <p role="status" className={report.pending}>
          正在判断是否需要补牌{fu.retry ? `（重试 ${fu.retry.attempt} / ${fu.retry.max}）` : '…'}
        </p>
      )}

      {/* 补充牌 */}
      {fu.additionalCards.length > 0 && (
        <div className={manual.supplement}>
          <h3>本次追问需要 {fu.additionalCards.length} 张补牌</h3>
          {fu.reason && <p>{fu.reason}</p>}
          <div className={report.cards}>
            {fu.additionalCards.map((drawn, index) => (
              <CardAutoReveal
                key={drawn.position.id}
                drawn={drawn}
                delay={index * 220}
                initiallyRevealed={fu.restored}
              />
            ))}
          </div>
        </div>
      )}

      {/* 追问解读 */}
      {!deciding && (fu.interpretation || fu.status === 'running' || fu.error || fu.notice) && (
        <ReadingReport
          content={fu.interpretation}
          running={fu.status === 'running'}
          error={fu.error}
          notice={fu.notice}
          retry={fu.retry}
          hasCards={hasBaseCards || fu.additionalCards.length > 0}
          cardTerms={cardTerms}
          positionTerms={positionTerms}
          onDetailInteraction={onDetailInteraction}
        />
      )}

      {canRegenerate && (
        <div className={report.reportActions}>
          <button
            data-small-action="text"
            type="button"
            onClick={() => onRegenerate(agentId, fu.id)}
          >
            {fu.decision === 'direct' || fu.additionalCards.length > 0
              ? '重新解读（保留原牌）'
              : '重试追问（可能补牌）'}
          </button>
        </div>
      )}
    </section>
  );
}

// ─── 术语提取（小型 memo hooks） ──────────────────────────

function useCardTerms(drawnCards: DrawnCard[]): string[] {
  return useMemo(() => drawnCards.flatMap((d) => [d.card.nameCn, d.card.name]), [drawnCards]);
}

function usePositionTerms(spread: Spread | null): string[] {
  return useMemo(() => (spread ? spread.positions.map((p) => p.nameCn) : []), [spread]);
}
