'use client';

import { Suspense, useRef, useState, type KeyboardEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { getDefaultSpread, getSpreadById } from '@/lib/tarot/spreads';
import { generalSpreads, resolveReadingEntry, type ReadingEntry } from '@/lib/readingEntry';
import Link from 'next/link';

import { CardDeck } from '@/components/drawing/CardDeck';
import { RitualHeader, RitualIcon } from '@/components/drawing/RitualScene';
import ritual from '@/components/drawing/RitualScene.module.css';
import { ManualDrawTable } from '@/components/drawing/ManualDrawTable';
import flow from './reading-flow.module.css';
import { SpreadSelector } from '@/components/drawing/SpreadSelector';

import { RevealStage } from '@/components/drawing/RevealStage';
import { useIntent } from '@/hooks/useIntent';
import { IntentFeedback } from '@/components/question/IntentFeedback';
import { useReading } from '@/hooks/useReading';
import { useApiConfig } from '@/hooks/useApiConfig';
import { useConfirm } from '@/hooks/useConfirm';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { QuestionWelcome } from '@/components/question/QuestionWelcome';
import { ManualReadingReport } from '@/components/reading/ManualReadingReport';
import { appendDraft } from '@/components/question/DraftAids';
import { useComposerViewport } from '@/hooks/useComposerViewport';

/* ═══════════════════════════════════════════════════════════════
   Ceremonial Acts · 仪式分幕
   每一次占卜是一场五幕剧 — 每一幕占满整个视野，
   幕次以巨型罗马数字水印沉在深渊里，代替一切进度指示。
   ═══════════════════════════════════════════════════════════════ */

interface ActMeta {
  numeral: string;
  ordinal: string;
  name: string;
}

const ACTS: Record<string, ActMeta> = {
  question: { numeral: 'I', ordinal: 'ACT Ⅰ', name: '提 问' },
  spread: { numeral: 'II', ordinal: 'ACT Ⅱ', name: '择 阵' },
  shuffle: { numeral: 'III', ordinal: 'ACT Ⅲ', name: '洗 牌' },
  draw: { numeral: 'IV', ordinal: 'ACT Ⅳ', name: '抽 牌' },
  reveal: { numeral: 'IV', ordinal: 'ACT Ⅳ', name: '揭 示' },
  interpret: { numeral: 'V', ordinal: 'ACT Ⅴ', name: '解 读' },
};

/* ═══════════════════════════════════════════════════════════════
   Page
   ═══════════════════════════════════════════════════════════════ */

export default function ReadingPage() {
  return (
    <Suspense fallback={<p role="status">正在准备牌阵…</p>}>
      <ReadingRoute />
    </Suspense>
  );
}

function ReadingRoute() {
  const params = useSearchParams();
  const entry = resolveReadingEntry(params);
  const [route, setRoute] = useState<{ identity: string; version: number; adoptingFrom?: string }>({
    identity: entry.identity,
    version: 0,
  });
  // External entries reset; an in-flow switch adopts the URL without losing drafts.
  if (route.identity !== entry.identity && route.adoptingFrom !== entry.identity) {
    setRoute({ identity: entry.identity, version: route.version + 1 });
  }
  if (route.adoptingFrom && entry.identity === route.identity)
    setRoute({ identity: route.identity, version: route.version });
  return (
    <ReadingFlow
      key={route.version}
      entry={entry}
      onGeneral={() => {
        setRoute((current) => ({
          ...current,
          identity: 'general',
          adoptingFrom: current.identity,
        }));
        window.history.replaceState(null, '', '/reading');
      }}
    />
  );
}

function ReadingFlow({ entry, onGeneral }: { entry: ReadingEntry; onGeneral: () => void }) {
  const [scene, setScene] = useState(entry.scene);
  const [preselected, setPreselected] = useState(!!entry.spread);
  const [changingSpread, setChangingSpread] = useState(false);
  const intent = useIntent();
  const reading = useReading(entry.spread, '', {
    intentId: intent.snapshot?.id,
    sceneId: scene?.id,
  });
  const {
    phase,
    question,
    spread,
    drawnCards,
    revealedCount,
    isInterpreting,
    hasInFlightFollowUp,
    setQuestion,
    setSpread,
    deck,
    slots,
    previewIndex,
    shuffleStatus,
    shuffleRound,
    startShuffle,
    finishShuffle,
    startDraw,
    previewCard,
    confirmCard,
    undoCard,
    enterReveal,
    returnToDraw,
    editReading,
    revealNextCard,
    revealAllCards,
    startInterpretation,
    redraw,
    goToPhase,
    reset,
  } = reading;

  const { config, isLoaded, canUseApi, intentEnabled } = useApiConfig();
  const { dialog, confirm, handleConfirm, handleCancel } = useConfirm();

  const act = ACTS[phase] ?? ACTS.question;

  const questionRef = useRef<HTMLTextAreaElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const { keyboardInset } = useComposerViewport(composerRef, phase);

  const handleStartInterpretation = (): void => {
    if (!canUseApi) return;
    startInterpretation(config);
  };

  const handleRedraw = async (): Promise<void> => {
    if (
      await confirm({
        title: '重新抽牌？',
        message:
          '将保留问题与牌阵，重新抽取一组牌。如果只想换一种解读，请选择“重新解读（保留原牌）”。已保存的历史仍保留。',
        confirmLabel: '确认重新抽牌',
      })
    ) {
      redraw();
    }
  };

  const handleEdit = async (target: 'question' | 'spread'): Promise<void> => {
    const name = target === 'question' ? '问题' : '牌阵';
    if (
      deck.length &&
      !(await confirm({
        title: `修改${name}？`,
        message: '修改后将放弃本轮牌堆与选择，需要重新洗牌。已保存的历史仍保留。',
        confirmLabel: '确认修改',
      }))
    )
      return;
    intent.reset();
    if (target === 'spread') {
      setScene(undefined);
      setPreselected(false);
      onGeneral();
      editReading(
        target,
        generalSpreads.find((item) => item.id === spread.id) ?? getDefaultSpread(),
      );
    } else editReading(target);
  };

  const advanceFromQuestion = async (): Promise<void> => {
    if (!question.trim() || intent.busy || !isLoaded) return;
    if (!intentEnabled) {
      goToPhase(preselected ? 'shuffle' : 'spread');
      return;
    }
    const result = await intent.analyze({ question: question.trim(), sceneId: scene?.id });
    if (result && result.plan.mode !== 'clarify') {
      setQuestion(result.question);
      goToPhase(preselected ? 'shuffle' : 'spread');
    }
  };
  const changeQuestion = (text: string) => {
    intent.invalidate();
    setQuestion(text);
  };

  const handleQuestionKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && question.trim()) {
      e.preventDefault();
      advanceFromQuestion();
    }
  };

  const handleNew = async (hasDraft: boolean, newQuestion?: string) => {
    if (
      (isInterpreting || hasInFlightFollowUp || hasDraft) &&
      !(await confirm({
        title: '开始新问题',
        confirmLabel: '开始新问题',
        message:
          isInterpreting || hasInFlightFollowUp
            ? '当前解读或补牌还未完成。开始新问题将结束本轮流程，已保存的记录仍可在轨迹中查看。'
            : '还有未发送的草稿。开始新问题将清空草稿，已保存的记录仍可在轨迹中查看。',
      }))
    )
      return;
    intent.reset();
    if (newQuestion) {
      setScene(undefined);
      onGeneral();
      reset({ question: newQuestion, spread: getDefaultSpread() });
    } else reset(scene ? { question: '', spread: getSpreadById(scene.spreadId)! } : undefined);
    setPreselected(!newQuestion && !!scene);
    setChangingSpread(false);
    window.scrollTo({ top: 0, behavior: 'instant' });
  };
  const confirmation = (
    <ConfirmDialog {...dialog} onConfirm={handleConfirm} onCancel={handleCancel} />
  );
  if (phase === 'question')
    return (
      <>
        <QuestionWelcome
          mode="manual"
          draft={question}
          onChange={changeQuestion}
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
          selectedSpread={preselected ? spread : undefined}
          scene={scene}
          onChangeSpread={() => {
            intent.reset();
            setScene(undefined);
            setPreselected(false);
            onGeneral();
            setSpread(generalSpreads.find((item) => item.id === spread.id) ?? getDefaultSpread());
            setChangingSpread(true);
            goToPhase('spread');
          }}
          spreadWarning={entry.warning}
          onPick={(text) => {
            changeQuestion(appendDraft(question, text));
            questionRef.current?.focus();
          }}
          onSend={advanceFromQuestion}
          onKeyDown={handleQuestionKeyDown}
          canSend={isLoaded && (!intentEnabled || canUseApi)}
          unavailable={false}
          busy={intent.busy}
          draftRef={questionRef}
          composerRef={composerRef}
          keyboardInset={keyboardInset}
        />
        {confirmation}
      </>
    );
  if (phase === 'interpret')
    return (
      <>
        <ManualReadingReport
          reading={reading}
          intentEnabled={intentEnabled}
          config={config}
          available={canUseApi}
          unavailable={isLoaded && !canUseApi}
          onRedraw={() => void handleRedraw()}
          onNew={(hasDraft, text) => void handleNew(hasDraft, text)}
        />
        {confirmation}
      </>
    );

  const isRitual = phase === 'shuffle' || phase === 'draw' || phase === 'reveal';

  return (
    <div
      data-ritual-root={isRitual ? '' : undefined}
      className={`relative ${isRitual ? ritual.theme : 'min-h-screen'}`}
    >
      {/* ═══════════════════════════════════════
          幕次水印 · 巨型罗马数字沉在深渊里
         ═══════════════════════════════════════ */}
      <div
        className={`fixed inset-0 z-0 pointer-events-none overflow-hidden ${isRitual ? 'hidden' : ''}`}
        aria-hidden
      >
        <div
          key={act.numeral}
          className="absolute inset-0 flex items-center justify-center anim-fade-in"
          style={{ animationDuration: '1800ms' }}
        >
          <span
            className="font-display font-bold select-none text-bone translate-x-[6vw] -translate-y-[4vh]"
            style={{
              fontSize: 'clamp(18rem, 48vw, 44rem)',
              lineHeight: 1,
              opacity: 0.045,
            }}
          >
            {act.numeral}
          </span>
          {/* 命运之轮 · 随幕缓转 */}
          <div
            className="arc-glow w-[72vmin] h-[72vmin] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
            style={{ animationDuration: '140s' }}
          />
        </div>
      </div>

      {/* ═══════════════════════════════════════
          页面导航
         ═══════════════════════════════════════ */}
      {phase === 'spread' ? (
        <header className={flow.spreadHeader}>
          <button
            data-small-action="text"
            type="button"
            aria-label="返回问题"
            onClick={() => {
              setChangingSpread(false);
              goToPhase('question');
            }}
          >
            <span>返回</span>
          </button>
          <Link data-small-action="text" href="/">
            <span>离开</span>
          </Link>
        </header>
      ) : isRitual ? (
        <header className={flow.shuffleExit}>
          <Link data-small-action="text" href="/" aria-label="离开占卜">
            <svg viewBox="0 0 24 24" aria-hidden>
              <path d="M19 12H5m5-5-5 5 5 5" />
            </svg>
            <span>离开</span>
          </Link>
        </header>
      ) : (
        <header className="fixed top-0 left-0 z-50 px-6 py-7 md:px-10">
          <Link
            data-small-action="text"
            href="/"
            className="group inline-flex items-center gap-4 text-bone-dim hover:text-bone transition-colors duration-500"
            style={{ transitionTimingFunction: 'var(--ease-ritual)' }}
          >
            <span
              className="text-base group-hover:-translate-x-1.5 transition-transform duration-700"
              style={{ transitionTimingFunction: 'var(--ease-veil)' }}
            >
              ←
            </span>
            <span className="cn-nav">离 开</span>
          </Link>
        </header>
      )}

      {/* 幕次字幕 · 左下隅 */}
      <div
        className={`fixed bottom-7 left-6 md:left-10 z-40 pointer-events-none select-none hidden ${isRitual || phase === 'spread' ? '' : 'sm:flex'} items-center gap-4`}
        aria-hidden
      >
        <span className="font-display text-xs tracking-[0.4em] text-gold-dim">{act.ordinal}</span>
        <span className="rule-h-gold w-10" />
        <span className="cn-label text-bone-faint">{act.name}</span>
      </div>

      {/* ═══════════════════════════════════════
          五幕 · 每一幕占满整个视野
         ═══════════════════════════════════════ */}
      <main id="main-content" className="relative z-10">
        {/* ─── 幕 Ⅱ · 择阵 · 悬浮于不同景深的面板 ─── */}
        {phase === 'spread' && (
          <section className={`act-fullscreen ${flow.spread}`}>
            <div className={flow.spreadPanel}>
              <SpreadSelector
                choices={generalSpreads}
                selectedSpread={spread}
                onSelect={setSpread}
                confirmLabel={changingSpread ? '使用此牌阵，返回问题' : undefined}
                onConfirm={() => {
                  if (changingSpread || (intentEnabled && !intent.snapshot)) {
                    setPreselected(true);
                    setChangingSpread(false);
                    goToPhase('question');
                  } else goToPhase('shuffle');
                }}
              />
            </div>
          </section>
        )}

        {/* ─── 幕 Ⅲ · 洗礼 · 牌堆居于舞台中央 ─── */}
        {phase === 'shuffle' && (
          <section className={`${ritual.content} ${ritual.shuffleScene}`} aria-label="洗牌">
            <RitualHeader
              title="洗牌"
              question={question}
              spreadName={spread.nameCn}
              count={spread.positions.length}
            />
            <CardDeck
              status={shuffleStatus}
              round={shuffleRound}
              onStart={startShuffle}
              onFinish={finishShuffle}
              onDraw={startDraw}
            >
              <div className={`${ritual.actions} ${ritual.shuffleActions}`}>
                <button data-small-action="text" onClick={() => void handleEdit('question')}>
                  <RitualIcon name="feather" />
                  修改问题
                </button>
                <button data-small-action="text" onClick={() => void handleEdit('spread')}>
                  <RitualIcon name="cards" />
                  修改牌阵
                </button>
              </div>
            </CardDeck>
          </section>
        )}

        {phase === 'draw' && (
          <section className={`${ritual.content} ${ritual.drawScene}`} aria-label="抽牌">
            <RitualHeader
              title="抽牌"
              question={question}
              spreadName={spread.nameCn}
              count={spread.positions.length}
            />
            <ManualDrawTable
              key={shuffleRound}
              spread={spread}
              deckSize={deck.length}
              slots={slots}
              previewIndex={previewIndex}
              onPreview={previewCard}
              onConfirm={confirmCard}
              onUndo={undoCard}
              onReveal={enterReveal}
              onEdit={(target) => {
                void handleEdit(target);
              }}
              onReshuffle={() => {
                void handleRedraw();
              }}
            />
          </section>
        )}

        {phase === 'reveal' && (
          <RevealStage
            question={question}
            spread={spread}
            drawnCards={drawnCards}
            revealedCount={revealedCount}
            canUseApi={canUseApi}
            isLoaded={isLoaded}
            isInterpreting={isInterpreting}
            onNext={revealNextCard}
            onAll={revealAllCards}
            onReturn={returnToDraw}
            onRedraw={handleRedraw}
            onInterpret={handleStartInterpretation}
          />
        )}

        {/* ─── 幕 Ⅴ · 神谕 · 卷轴徐徐展开 ─── */}
      </main>
      <ConfirmDialog {...dialog} onConfirm={handleConfirm} onCancel={handleCancel} />
    </div>
  );
}
