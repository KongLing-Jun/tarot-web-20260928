'use client';

import type { IntentReference } from '@/lib/intent/types';
import { useState, useCallback, useRef, useEffect } from 'react';
import { Spread, Reading, ApiConfig, FollowUp } from '@/lib/tarot/types';
import { drawSupplementaryCards } from '@/lib/tarot/draw';
import { getDefaultSpread } from '@/lib/tarot/spreads';
import {
  saveReading,
  updateReadingFollowUps,
  updateReadingInterpretation,
} from '@/lib/readingStorage';
import { buildFollowUpHistory } from '@/lib/followUpHistory';
import { ApiError } from '@/lib/api/client';
import { useManualDraw } from './useManualDraw';
import { extractDecisionJson as extractDecisionJsonUtil } from '@/lib/tarot/sseUtils';
import { streamInterpret, type RetryState } from '@/lib/api/stream-client';
import { createStreamTextBuffer } from '@/lib/api/stream-buffer';
import { LLMError, classifyError } from '@/lib/api/errors';
import { genId } from '@/lib/id';
import { hasValidAnswer, type GenerationStatus } from '@/lib/api/generation-result';
import { presentGeneration } from '@/lib/api/generation-presentation';
import { validateInterpretationQuality } from '@/lib/interpretation-quality';

export type { ReadingPhase } from '@/lib/tarot/manual-draw';

const extractDecisionJson = extractDecisionJsonUtil;

// ─── 错误消息提取 ────────────────────────────────────────────

function getErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return `历史记录保存失败：${err.message}`;
  if (err instanceof LLMError) return err.info.message;
  const info = classifyError(err);
  return info.message;
}

// ─── Hook ────────────────────────────────────────────────────

export function useReading(
  initialSpread?: Spread,
  initialQuestion = '',
  intent: IntentReference = {},
) {
  const { intentId, sceneId } = intent;
  const [question, setQuestion] = useState(() => initialQuestion);
  const [spread, setSpread] = useState<Spread>(() => initialSpread ?? getDefaultSpread());
  const manual = useManualDraw(spread);
  const { phase, drawnCards, revealedCount, dispatch } = manual;
  const [interpretation, setInterpretation] = useState('');
  const [isInterpreting, setIsInterpreting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 非致命警示（如输出被截断）· 与 error 分离，不遮蔽已生成的正文
  const [notice, setNotice] = useState<string | null>(null);
  // 主解读自动重试的瞬时状态（连接中断重试时非空）
  const [retryInfo, setRetryInfo] = useState<RetryState | null>(null);
  // 各追问的自动重试状态 · 以 followUpId 为键
  const [followUpRetries, setFollowUpRetries] = useState<Record<string, RetryState | null>>({});

  // ── 追问状态 ─────────────────────────────────────────────
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  // 异步决策、快速连点都必须读取最新追问，不能依赖发起请求时的渲染闭包。
  const followUpsRef = useRef<FollowUp[]>([]);
  const [readingId, setReadingId] = useState<string | null>(null);
  const draftReading = useRef<Reading | null>(null);
  const initialSave = useRef<Promise<void> | null>(null);
  const pendingInterpretationSave = useRef<{
    id: string;
    text: string;
    generationStatus: GenerationStatus;
  } | null>(null);

  const updateFollowUps = useCallback((update: (current: FollowUp[]) => FollowUp[]) => {
    const next = update(followUpsRef.current);
    followUpsRef.current = next;
    setFollowUps(next);
  }, []);

  // ── AbortController 管理 ─────────────────────────────────
  // 保存当前活跃请求的 AbortController，用于取消
  const activeAbortRef = useRef<AbortController | null>(null);
  const activeStreamRef = useRef<{ flush: () => void; main: boolean } | null>(null);

  /** 取消当前正在进行的 LLM 请求 */
  const cancelRequest = useCallback(() => {
    if (activeAbortRef.current) {
      activeStreamRef.current?.flush();
      if (activeStreamRef.current?.main) {
        setNotice('已停止生成，已保留当前内容，可保留原牌重试。');
      }
      activeStreamRef.current = null;
      activeAbortRef.current.abort();
      activeAbortRef.current = null;
      setIsInterpreting(false);
      setRetryInfo(null);
      updateFollowUps((current) =>
        current.map((fu) =>
          fu.status === 'deciding' || fu.status === 'interpreting'
            ? {
                ...fu,
                status: 'error',
                generationStatus: 'cancelled',
                error: '已停止生成，可保留当前牌面重试。',
              }
            : fu,
        ),
      );
      if (readingId && followUpsRef.current.length) {
        void updateReadingFollowUps(readingId, followUpsRef.current).catch((err) =>
          setError(getErrorMessage(err)),
        );
      }
      setFollowUpRetries({});
    }
  }, [updateFollowUps, readingId]);

  /** 创建新的 AbortController 并取消旧的 */
  const createAbortController = useCallback((): AbortController => {
    cancelRequest(); // 取消旧的
    const controller = new AbortController();
    activeAbortRef.current = controller;
    return controller;
  }, [cancelRequest]);

  const patchFollowUp = useCallback(
    (id: string, patch: Partial<FollowUp> | ((prev: FollowUp) => Partial<FollowUp>)) => {
      updateFollowUps((prev) =>
        prev.map((fu) => {
          if (fu.id !== id) return fu;
          const p = typeof patch === 'function' ? patch(fu) : patch;
          return { ...fu, ...p };
        }),
      );
    },
    [updateFollowUps],
  );

  useEffect(() => () => activeAbortRef.current?.abort(), []);

  const revealCards = useCallback(
    (type: 'reveal-next' | 'reveal-all') => {
      const currentDraw = dispatch({ type });
      // The first reveal fixes the chosen cards; before it users may return and adjust.
      if (!currentDraw.revealedCount || draftReading.current) return;
      const reading: Reading = {
        id: genId(),
        intentId,
        sceneId,
        question,
        spread,
        drawnCards: currentDraw.drawnCards,
        interpretation: '',
        createdAt: new Date(),
      };
      draftReading.current = reading;
      initialSave.current = saveReading(reading);
      void initialSave.current
        .then(() => {
          if (draftReading.current === reading) setReadingId(reading.id);
        })
        .catch((err) => {
          if (draftReading.current === reading) setError(getErrorMessage(err));
        });
    },
    [dispatch, question, spread, intentId, sceneId],
  );
  const revealNextCard = useCallback(() => {
    revealCards('reveal-next');
  }, [revealCards]);
  const revealAllCards = useCallback(() => {
    revealCards('reveal-all');
  }, [revealCards]);

  // ── 主解读 ───────────────────────────────────────────────

  const startInterpretation = useCallback(
    async (apiConfig: ApiConfig) => {
      if (pendingInterpretationSave.current) {
        const pending = pendingInterpretationSave.current;
        try {
          await updateReadingInterpretation(pending.id, pending.text, pending.generationStatus);
          if (pendingInterpretationSave.current === pending) {
            pendingInterpretationSave.current = null;
            setNotice(null);
          }
        } catch {
          setNotice('解读内容已保留，但历史记录保存失败；重试会先补存当前内容。');
        }
        return;
      }
      const currentDraw = dispatch({ type: 'interpret' });
      if (currentDraw.phase !== 'interpret') return;
      const cardsForReading = currentDraw.drawnCards;
      const controller = createAbortController();
      const isCurrent = () => activeAbortRef.current === controller && !controller.signal.aborted;
      setIsInterpreting(true);
      setError(null);
      setNotice(null);
      setRetryInfo(null);

      // 节流 setState：长思考时 token 极密，逐 chunk setState 会卡死神谕阶段
      // 重试收到新正文前保留上次内容，空缓冲不得覆盖已经显示的解读。
      const textBuffer = createStreamTextBuffer((text) => {
        if (isCurrent() && text) setInterpretation(text);
      });
      activeStreamRef.current = { flush: textBuffer.flush, main: true };

      try {
        const draft = draftReading.current ?? {
          id: readingId ?? genId(),
          intentId,
          sceneId,
          question,
          spread,
          drawnCards: cardsForReading,
          interpretation: '',
          createdAt: new Date(),
        };
        draftReading.current = draft;
        if (initialSave.current) {
          try {
            await initialSave.current;
          } catch {
            if (!isCurrent() || draftReading.current !== draft) return;
            initialSave.current = saveReading(draft);
            await initialSave.current;
          }
        } else {
          initialSave.current = saveReading(draft);
          await initialSave.current;
        }
        if (!isCurrent()) return;
        setReadingId(draft.id);
        const result = await streamInterpret(
          {
            question,
            spread,
            drawnCards: cardsForReading,
            apiConfig,
            readingId: draft.id,
            intentId: draft.intentId,
            sceneId: draft.sceneId,
          },
          {
            onContent: (chunk) => {
              if (isCurrent()) textBuffer.append(chunk);
            },
            onThinking: (chunk) => {
              if (isCurrent()) textBuffer.append(chunk);
            },
            onStreamError: (msg) => {
              if (isCurrent()) setError(msg);
            },
            onRetry: (attempt, max) => {
              if (isCurrent()) {
                textBuffer.reset();
                setInterpretation(interpretation);
                setRetryInfo({ attempt, max });
              }
            },
          },
          { signal: controller.signal },
        );

        // 确保最后一帧完整刷到 UI（以服务端累积的 fullText 为准）
        if (!isCurrent()) return;
        textBuffer.flush();
        if (result.fullText) {
          setInterpretation(result.fullText);
        }

        const quality = validateInterpretationQuality(result.fullText, {
          mode: 'initial',
          drawnCards: cardsForReading,
        });
        const presentation = presentGeneration({ ...result, quality }, result.fullText);
        if (presentation.error) setError((previous) => previous ?? presentation.error);
        if (presentation.notice) setNotice(presentation.notice);
        if (result.fullText) {
          const id = draft.id;
          try {
            await updateReadingInterpretation(id, result.fullText, presentation.generationStatus);
            if (isCurrent())
              setNotice(
                presentGeneration(
                  { ...result, quality, persistenceStatus: 'saved' },
                  result.fullText,
                ).notice,
              );
          } catch {
            if (!isCurrent()) return;
            if (presentation.generationStatus === 'completed')
              pendingInterpretationSave.current = {
                id,
                text: result.fullText,
                generationStatus: presentation.generationStatus,
              };
            setNotice('解读内容已保留，但历史记录保存失败；重试会先补存当前内容。');
            return;
          }
          if (!isCurrent()) return;
          setReadingId(id);

          if (result.truncated) {
            setNotice(
              '解读内容因模型输出长度限制被截断，已显示部分内容。建议在设置中切换更高输出限制的模型，或使用追问功能获取剩余内容。',
            );
          }
        } else if (!result.receivedError) {
          setError('未收到有效解读内容，连接可能被网关提前中断');
        }
      } catch (err) {
        if (!isCurrent()) return;
        textBuffer.flush();
        // ABORTED 不算错误（用户主动取消）
        if (err instanceof LLMError && err.info.code === 'ABORTED') {
          // 用户取消，静默处理
          return;
        }
        setError(getErrorMessage(err));
      } finally {
        textBuffer.dispose();
        if (activeAbortRef.current === controller) {
          setIsInterpreting(false);
          setRetryInfo(null);
          activeStreamRef.current = null;
          activeAbortRef.current = null;
        }
      }
    },
    [
      question,
      spread,
      readingId,
      interpretation,
      createAbortController,
      dispatch,
      intentId,
      sceneId,
    ],
  );

  // ── 追问解读 ─────────────────────────────────────────────

  const runFollowUpInterpretation = useCallback(
    async (followUpId: string, apiConfig: ApiConfig): Promise<void> => {
      const target = followUpsRef.current.find((fu) => fu.id === followUpId);
      if (!target || !target.decision || activeAbortRef.current) return;

      const mode = target.decision === 'draw' ? 'with-extras' : 'direct';
      patchFollowUp(followUpId, { status: 'interpreting', error: null });

      const controller = createAbortController();
      const isCurrent = () => activeAbortRef.current === controller && !controller.signal.aborted;
      const textBuffer = createStreamTextBuffer((text) => {
        if (isCurrent() && text) patchFollowUp(followUpId, { interpretation: text });
      });
      activeStreamRef.current = { flush: textBuffer.flush, main: false };

      try {
        if (readingId) await updateReadingFollowUps(readingId, followUpsRef.current);
        if (!isCurrent()) return;
        const result = await streamInterpret(
          {
            question,
            spread,
            drawnCards,
            apiConfig,
            readingId: readingId ?? undefined,
            intentId: target.intentId,
            sceneId: sceneId,
            followUp: {
              mode,
              previousInterpretation: interpretation,
              followUpQuestion: target.question,
              additionalCards: mode === 'with-extras' ? target.additionalCards : undefined,
              history: buildFollowUpHistory(followUpsRef.current, followUpId),
            },
          },
          {
            onContent: (chunk) => textBuffer.append(chunk),
            onThinking: (chunk) => textBuffer.append(chunk),
            onStreamError: (msg) => {
              if (isCurrent()) patchFollowUp(followUpId, { error: msg });
            },
            onRetry: (attempt, max) => {
              if (isCurrent()) {
                textBuffer.reset();
                patchFollowUp(followUpId, { interpretation: target.interpretation });
                setFollowUpRetries((prev) => ({ ...prev, [followUpId]: { attempt, max } }));
              }
            },
          },
          { signal: controller.signal },
        );

        if (!isCurrent()) return;
        textBuffer.flush();
        if (result.fullText) {
          patchFollowUp(followUpId, { interpretation: result.fullText });
        }

        patchFollowUp(followUpId, (previous) => {
          const quality = validateInterpretationQuality(result.fullText, {
            mode: mode === 'with-extras' ? 'supplementary' : 'follow-up',
            drawnCards,
            additionalCards: target.additionalCards,
            historyCards: followUpsRef.current
              .slice(
                0,
                followUpsRef.current.findIndex((followUp) => followUp.id === followUpId),
              )
              .flatMap((followUp) => followUp.additionalCards),
          });
          return presentGeneration({ ...result, quality }, result.fullText, previous.error);
        });
      } catch (err) {
        if (!isCurrent()) return;
        textBuffer.flush();
        if (err instanceof LLMError && err.info.code === 'ABORTED') return;
        patchFollowUp(followUpId, {
          status: 'error',
          error: getErrorMessage(err),
        });
      } finally {
        textBuffer.dispose();
        if (activeAbortRef.current === controller) {
          activeStreamRef.current = null;
          if (readingId) {
            try {
              await updateReadingFollowUps(readingId, followUpsRef.current);
            } catch (err) {
              if (isCurrent()) {
                patchFollowUp(followUpId, { persistenceStatus: 'failed' });
                setNotice(getErrorMessage(err));
              }
            }
          }
          if (activeAbortRef.current === controller) {
            setFollowUpRetries((prev) => {
              if (!(followUpId in prev)) return prev;
              const next = { ...prev };
              delete next[followUpId];
              return next;
            });
            activeAbortRef.current = null;
          }
        }
      }
    },
    [
      question,
      spread,
      drawnCards,
      interpretation,
      patchFollowUp,
      readingId,
      createAbortController,
      sceneId,
    ],
  );

  // ── 追问入口 ─────────────────────────────────────────────

  const decideFollowUp = useCallback(
    async (target: FollowUp, apiConfig: ApiConfig): Promise<void> => {
      if (activeAbortRef.current) return;
      const id = target.id;
      patchFollowUp(id, { status: 'deciding', error: null });
      const controller = createAbortController();
      const isCurrent = () => activeAbortRef.current === controller && !controller.signal.aborted;

      // ── 决策步 ──
      let decideBuffer = '';
      try {
        if (readingId) await updateReadingFollowUps(readingId, followUpsRef.current);
        if (!isCurrent()) return;
        const result = await streamInterpret(
          {
            question,
            spread,
            drawnCards,
            apiConfig,
            readingId: readingId ?? undefined,
            intentId: target.intentId,
            sceneId: sceneId,
            followUp: {
              mode: 'decide',
              previousInterpretation: interpretation,
              followUpQuestion: target.question,
              history: buildFollowUpHistory(followUpsRef.current, id),
            },
          },
          {
            onContent: (chunk) => {
              decideBuffer += chunk;
            },
            onThinking: (chunk) => {
              decideBuffer += chunk;
            },
          },
          {
            signal: controller.signal,
            maxRetries: 1, // 决策步不需要太多重试
          },
        );

        if (!isCurrent()) return;
        const decisionText = result.answer ?? result.fullText ?? decideBuffer;
        const incomplete =
          result.receivedError ||
          result.truncated ||
          (result.generationStatus !== undefined && result.generationStatus !== 'completed');
        const decision =
          incomplete || !hasValidAnswer(decisionText) ? null : extractDecisionJson(decisionText);
        if (!decision) {
          patchFollowUp(id, {
            status: 'error',
            error: '暂时无法解析回复，请重试',
          });
          return;
        }

        if (decision.decision === 'direct') {
          patchFollowUp(id, {
            decision: 'direct',
            drawCount: 0,
            reason: decision.reason,
          });
          activeAbortRef.current = null;
          await runFollowUpInterpretation(id, apiConfig);
        } else {
          const additionalCards = drawSupplementaryCards(decision.drawCount, 0);
          patchFollowUp(id, {
            decision: 'draw',
            drawCount: decision.drawCount,
            reason: decision.reason,
            additionalCards,
            revealedCount: 0,
            status: 'awaiting-reveal',
          });
        }
      } catch (err) {
        if (!isCurrent()) return;
        if (err instanceof LLMError && err.info.code === 'ABORTED') return;
        patchFollowUp(id, {
          status: 'error',
          error: getErrorMessage(err),
        });
      } finally {
        if (isCurrent() && readingId) {
          try {
            await updateReadingFollowUps(readingId, followUpsRef.current);
          } catch (err) {
            setError(getErrorMessage(err));
          }
        }
        if (activeAbortRef.current === controller) {
          activeAbortRef.current = null;
        }
      }
    },
    [
      interpretation,
      question,
      spread,
      drawnCards,
      patchFollowUp,
      runFollowUpInterpretation,
      createAbortController,
      readingId,
      sceneId,
    ],
  );

  const askFollowUp = useCallback(
    async (
      followUpQuestion: string,
      apiConfig: ApiConfig,
      options?: { direct?: boolean; intentId?: string },
    ): Promise<void> => {
      const trimmed = followUpQuestion.trim();
      if (
        !trimmed ||
        !interpretation ||
        activeAbortRef.current ||
        followUpsRef.current.some(
          (fu) =>
            fu.status === 'deciding' ||
            fu.status === 'interpreting' ||
            fu.status === 'awaiting-reveal',
        )
      )
        return;
      const draft: FollowUp = {
        id: genId(),
        question: trimmed,
        intentId: options?.intentId,
        status: 'deciding',
        drawCount: 0,
        additionalCards: [],
        revealedCount: 0,
        interpretation: '',
        error: null,
        ...(options?.direct ? { decision: 'direct' as const } : {}),
      };
      updateFollowUps((current) => [...current, draft]);
      if (options?.direct) await runFollowUpInterpretation(draft.id, apiConfig);
      else await decideFollowUp(draft, apiConfig);
    },
    [interpretation, updateFollowUps, decideFollowUp, runFollowUpInterpretation],
  );

  // ── 翻牌 & 重试 ─────────────────────────────────────────

  const revealNextFollowUpCard = useCallback(
    (followUpId: string, apiConfig: ApiConfig) => {
      const target = followUpsRef.current.find((fu) => fu.id === followUpId);
      if (
        !target ||
        target.status !== 'awaiting-reveal' ||
        target.revealedCount >= target.additionalCards.length
      )
        return;
      const revealedCount = target.revealedCount + 1;
      patchFollowUp(followUpId, { revealedCount });
      if (revealedCount === target.additionalCards.length)
        void runFollowUpInterpretation(followUpId, apiConfig);
    },
    [patchFollowUp, runFollowUpInterpretation],
  );

  const revealAllFollowUpCards = useCallback(
    (followUpId: string, apiConfig: ApiConfig) => {
      const target = followUpsRef.current.find((fu) => fu.id === followUpId);
      if (
        !target ||
        target.status !== 'awaiting-reveal' ||
        target.revealedCount >= target.additionalCards.length
      )
        return;
      patchFollowUp(followUpId, { revealedCount: target.additionalCards.length });
      void runFollowUpInterpretation(followUpId, apiConfig);
    },
    [patchFollowUp, runFollowUpInterpretation],
  );

  const retryFollowUp = useCallback(
    async (followUpId: string, apiConfig: ApiConfig) => {
      const target = followUpsRef.current.find((fu) => fu.id === followUpId);
      if (!target || activeAbortRef.current) return;
      if (
        target.persistenceStatus === 'failed' &&
        target.generationStatus === 'completed' &&
        readingId
      ) {
        try {
          patchFollowUp(followUpId, { error: null });
          await updateReadingFollowUps(readingId, followUpsRef.current);
          patchFollowUp(followUpId, { persistenceStatus: 'saved' });
          setNotice(null);
        } catch (err) {
          setNotice(getErrorMessage(err));
        }
        return;
      }
      if (target.status !== 'error') return;
      if (target.decision) {
        await runFollowUpInterpretation(followUpId, apiConfig);
      } else {
        await decideFollowUp(target, apiConfig);
      }
    },
    [runFollowUpInterpretation, decideFollowUp, readingId, patchFollowUp],
  );

  const hasInFlightFollowUp = followUps.some(
    (fu) =>
      fu.status === 'deciding' || fu.status === 'awaiting-reveal' || fu.status === 'interpreting',
  );

  // ── 重置 & 导航 ─────────────────────────────────────────

  const reset = useCallback(
    (initial?: { question: string; spread: Spread }) => {
      cancelRequest(); // 取消任何进行中的请求
      dispatch({ type: 'reset', phase: 'question' });
      setQuestion(initial?.question ?? '');
      setSpread(initial?.spread ?? getDefaultSpread());
      setInterpretation('');
      setIsInterpreting(false);
      setError(null);
      setNotice(null);
      setRetryInfo(null);
      setFollowUpRetries({});
      updateFollowUps(() => []);
      setReadingId(null);
      draftReading.current = null;
      initialSave.current = null;
      pendingInterpretationSave.current = null;
    },
    [cancelRequest, updateFollowUps, dispatch],
  );

  const redraw = useCallback(() => {
    reset();
    setQuestion(question);
    setSpread(spread);
    dispatch({ type: 'reset', phase: 'shuffle' });
  }, [reset, question, spread, dispatch]);

  const goToPhase = useCallback(
    (newPhase: 'question' | 'spread' | 'shuffle') => {
      dispatch({ type: 'navigate', phase: newPhase });
    },
    [dispatch],
  );

  const editReading = useCallback(
    (newPhase: 'question' | 'spread', nextSpread = spread) => {
      reset();
      setQuestion(question);
      setSpread(nextSpread);
      dispatch({ type: 'reset', phase: newPhase });
    },
    [reset, question, spread, dispatch],
  );

  return {
    phase,
    readingId,
    question,
    spread,
    drawnCards,
    revealedCount,
    interpretation,
    isInterpreting,
    error,
    notice,
    retryInfo,
    followUpRetries,
    followUps,
    hasInFlightFollowUp,
    setQuestion: (value: string) => {
      if (phase === 'question') setQuestion(value);
    },
    setSpread: (value: Spread) => {
      if (phase === 'question' || phase === 'spread') setSpread(value);
    },
    deck: manual.deck,
    slots: manual.slots,
    previewIndex: manual.previewIndex,
    shuffleStatus: manual.shuffleStatus,
    shuffleRound: manual.round,
    startShuffle: manual.startShuffle,
    finishShuffle: manual.finishShuffle,
    startDraw: manual.startDraw,
    previewCard: (index: number | null) => {
      dispatch({ type: 'preview', index });
    },
    confirmCard: () => {
      dispatch({ type: 'confirm' });
      // Reducer checks the updated slots; returning to adjust never triggers this transition.
      dispatch({ type: 'enter-reveal', spread });
    },
    undoCard: (slot: number) => {
      dispatch({ type: 'undo', slot });
    },
    enterReveal: () => {
      dispatch({ type: 'enter-reveal', spread });
    },
    returnToDraw: () => {
      dispatch({ type: 'return-draw' });
    },
    editReading,
    revealNextCard,
    revealAllCards,
    startInterpretation,
    askFollowUp,
    revealNextFollowUpCard,
    revealAllFollowUpCards,
    retryFollowUp,
    cancelRequest,
    reset,
    redraw,
    goToPhase,
  };
}
