'use client';

/**
 * Agent 对话状态管理 · 取代 useReading 的线性状态机
 *
 * 以「消息列表」为核心：用户消息 + Agent 消息（内嵌牌阵/牌面/解读）。
 * 一个 Agent 消息即一个完整回合：选牌阵 → 抽牌 → 流式解读。
 * 追问作为后续 Agent 消息追加，复用 decide/draw 协议。
 */

import type { IntentReference } from '@/lib/intent/types';
import { useState, useCallback, useRef, useEffect } from 'react';
import { ApiConfig, DrawnCard, FollowUp, Reading, Spread } from '@/lib/tarot/types';
import {
  saveReading,
  updateReadingFollowUps,
  updateReadingInterpretation,
} from '@/lib/readingStorage';
import {
  rerunAgentInterpretation,
  rerunFollowUpInterpretation,
  runAgentTurn,
  runFollowUpTurn,
} from '@/lib/agent/agentTurn';
import { LLMError, classifyError } from '@/lib/api/errors';
import type { RetryState } from '@/lib/api/stream-client';
import { genId } from '@/lib/id';
import { ApiError } from '@/lib/api/client';
import { buildFollowUpHistory } from '@/lib/followUpHistory';
import { hasValidAnswer } from '@/lib/api/generation-result';
import { presentGeneration, type GenerationOutcome } from '@/lib/api/generation-presentation';
import { validateInterpretationQuality } from '@/lib/interpretation-quality';
import type { ReadingCompletion } from '@/lib/readingResume';
import {
  loadAgentSession,
  saveAgentSession,
  type RestoredAgentTask,
} from '@/lib/agentSessionStorage';

// ─── 消息模型 ───────────────────────────────────────────────

export type AgentMessageStatus = 'running' | 'done' | 'error';

/** 用户消息 */
export interface UserMessage {
  id: string;
  role: 'user';
  content: string;
}

/** 首轮 Agent 回合消息（含牌阵与牌面） */
export interface AgentMessage extends GenerationOutcome, IntentReference {
  restored?: boolean;
  id: string;
  role: 'agent';
  content: string;
  status: AgentMessageStatus;
  error: string | null;
  /** 选定的牌阵与理由 */
  spread: Spread | null;
  spreadReason: string;
  /** 抽到的牌 */
  drawnCards: DrawnCard[];
  /** 非致命提示（如输出被截断） */
  notice: string | null;
  /** 关联的 Reading id，用于持久化 */
  readingId: string | null;
  readingSaved?: boolean;
  /** 自动重试的瞬时状态（连接中断重试时非空） */
  retry: RetryState | null;
  /** 追问列表 */
  followUps: FollowUpMessage[];
}

/** 追问消息（嵌套在 Agent 首轮消息的 followUps 中） */
export interface FollowUpMessage extends GenerationOutcome {
  intentId?: string;
  restored?: boolean;
  id: string;
  question: string;
  status: AgentMessageStatus;
  decision: 'direct' | 'draw' | null;
  drawCount: number;
  reason: string;
  additionalCards: DrawnCard[];
  interpretation: string;
  error: string | null;
  notice: string | null;
  /** 自动重试的瞬时状态 */
  retry: RetryState | null;
}

export type ChatMessage = UserMessage | AgentMessage;

// ─── 工厂 ───────────────────────────────────────────────────

function makeUserMessage(content: string): UserMessage {
  return { id: genId(), role: 'user', content };
}

function makeAgentMessage(): AgentMessage {
  return {
    id: genId(),
    role: 'agent',
    content: '',
    status: 'running',
    error: null,
    spread: null,
    spreadReason: '',
    drawnCards: [],
    notice: null,
    readingId: null,
    retry: null,
    followUps: [],
  };
}

function makeFollowUpMessage(question: string): FollowUpMessage {
  return {
    id: genId(),
    question,
    status: 'running',
    decision: null,
    drawCount: 0,
    reason: '',
    additionalCards: [],
    interpretation: '',
    error: null,
    notice: null,
    retry: null,
  };
}

// ─── 错误消息提取 ────────────────────────────────────────────

function getErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return `历史记录保存失败：${err.message}`;
  if (err instanceof LLMError) return err.info.message;
  return classifyError(err).message;
}

async function persistGenerated(
  write: () => Promise<void>,
  patch: (value: { persistenceStatus: 'saved' | 'failed'; notice?: string | null }) => void,
  savedNotice?: string | null,
) {
  try {
    await write();
    patch({
      persistenceStatus: 'saved',
      ...(savedNotice !== undefined ? { notice: savedNotice } : {}),
    });
  } catch {
    patch({
      persistenceStatus: 'failed',
      notice: '解读内容已保留，但历史记录保存失败；重试会先补存当前内容。',
    });
  }
}

function toStoredFollowUps(agent: AgentMessage): FollowUp[] {
  return agent.followUps.map((fu) => ({
    id: fu.id,
    intentId: fu.intentId,
    question: fu.question,
    status: fu.status === 'running' ? ('interpreting' as const) : fu.status,
    decision: fu.decision ?? undefined,
    drawCount: fu.drawCount,
    reason: fu.reason,
    additionalCards: fu.additionalCards,
    revealedCount: fu.additionalCards.length,
    interpretation: fu.interpretation,
    error: fu.error,
    generationStatus: fu.generationStatus === 'running' ? undefined : fu.generationStatus,
  }));
}

// ─── Hook ───────────────────────────────────────────────────

export function useAgentChat(authenticated?: boolean) {
  const persistent = authenticated !== undefined;
  const [sessionReady, setSessionReady] = useState(!persistent);
  const [sessionError, setSessionError] = useState('');
  const revision = useRef(0);
  const sessionWrites = useRef<Promise<unknown>>(Promise.resolve());
  const sessionAbort = useRef<AbortController | null>(null);
  const sessionVersion = useRef(0);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isRunning, setIsRunning] = useState(false);

  // messages 的 ref 镜像，供异步流程在不依赖 state 闭包的节点读取最新值
  const messagesRef = useRef<ChatMessage[]>([]);

  const persistSession = useCallback(async () => {
    if (!persistent) return;
    const signal = sessionAbort.current?.signal;
    const tasks = messagesRef.current.flatMap((message, index, all) => {
      if (message.role !== 'agent' || !message.readingId) return [];
      const question = all
        .slice(0, index)
        .reverse()
        .find((item) => item.role === 'user');
      return question?.role === 'user'
        ? [{ id: message.id, question: question.content, readingId: message.readingId }]
        : [];
    });
    const write = sessionWrites.current
      .catch(() => {})
      .then(async () => {
        if (!signal || signal.aborted) throw new Error('登录会话已结束');
        const result = await saveAgentSession(tasks, revision.current, signal);
        if (!signal.aborted) {
          revision.current = result.revision;
          setSessionError('');
        }
      });
    sessionWrites.current = write;
    try {
      await write;
    } catch (error) {
      if (!signal?.aborted)
        setSessionError(error instanceof Error ? error.message : '对话保存失败，请重试');
      throw error;
    }
  }, [persistent]);

  /** 统一的 messages 提交函数：同步更新 ref 镜像 */
  const commit = useCallback((updater: (prev: ChatMessage[]) => ChatMessage[]) => {
    const next = updater(messagesRef.current);
    messagesRef.current = next;
    setMessages(next);
  }, []);

  // AbortController 管理
  const activeAbortRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    if (activeAbortRef.current) {
      activeAbortRef.current.abort();
      activeAbortRef.current = null;
    }
  }, []);

  const createController = useCallback((): AbortController => {
    cancel();
    const controller = new AbortController();
    activeAbortRef.current = controller;
    return controller;
  }, [cancel]);

  const preserveInterruptedFollowUps = useCallback(() => {
    for (const message of messagesRef.current) {
      if (
        message.role !== 'agent' ||
        !message.readingId ||
        !message.followUps.some((fu) => fu.status === 'running')
      )
        continue;
      const snapshot: AgentMessage = {
        ...message,
        followUps: message.followUps.map((fu) =>
          fu.status === 'running'
            ? { ...fu, status: 'error', error: '上次追问未完成，已保留内容和牌面。' }
            : fu,
        ),
      };
      void updateReadingFollowUps(message.readingId, toStoredFollowUps(snapshot)).catch((error) =>
        console.error(getErrorMessage(error)),
      );
    }
  }, []);

  useEffect(
    () => () => {
      // 仅在全局对话会话销毁（如退出登录）时取消；页面切换不销毁它。
      preserveInterruptedFollowUps();
      sessionVersion.current += 1;
      activeAbortRef.current?.abort();
    },
    [preserveInterruptedFollowUps],
  );

  // ── 局部更新工具 ───────────────────────────────────────
  const patchAgent = useCallback(
    (
      agentId: string,
      patch: Partial<AgentMessage> | ((prev: AgentMessage) => Partial<AgentMessage>),
    ) => {
      commit((prev) => {
        let changed = false;
        const next = prev.map((message) => {
          if (message.role !== 'agent' || message.id !== agentId) return message;
          changed = true;
          const p = typeof patch === 'function' ? patch(message) : patch;
          return { ...message, ...p };
        });

        return changed ? next : prev;
      });
    },
    [commit],
  );

  const patchFollowUp = useCallback(
    (
      followUpId: string,
      patch: Partial<FollowUpMessage> | ((prev: FollowUpMessage) => Partial<FollowUpMessage>),
    ) => {
      commit((prev) => {
        let changed = false;
        const next = prev.map((message) => {
          if (message.role !== 'agent' || !message.followUps.some((fu) => fu.id === followUpId)) {
            return message;
          }

          changed = true;
          return {
            ...message,
            followUps: message.followUps.map((fu) => {
              if (fu.id !== followUpId) return fu;
              const p = typeof patch === 'function' ? patch(fu) : patch;
              return { ...fu, ...p };
            }),
          };
        });

        return changed ? next : prev;
      });
    },
    [commit],
  );

  const findOriginalQuestion = useCallback((agentId: string): string => {
    const current = messagesRef.current;
    const agentIndex = current.findIndex(
      (message) => message.role === 'agent' && message.id === agentId,
    );

    for (let i = agentIndex - 1; i >= 0; i--) {
      const message = current[i];
      if (message.role === 'user') return message.content;
    }

    return '';
  }, []);

  const persistFollowUpsForAgent = useCallback(async (agentId: string): Promise<void> => {
    const agent = messagesRef.current.find(
      (message) => message.role === 'agent' && message.id === agentId,
    );
    if (!agent || agent.role !== 'agent' || !agent.readingId) return;
    await updateReadingFollowUps(agent.readingId, toStoredFollowUps(agent));
  }, []);

  // 旧会话的流、保存收尾和回调都不能写入恢复后的会话。
  const captureSession = useCallback(() => {
    const version = sessionVersion.current;
    const isCurrent = () => version === sessionVersion.current;
    return {
      isCurrent,
      patchAgent: (...args: Parameters<typeof patchAgent>) => {
        if (isCurrent()) patchAgent(...args);
      },
      patchFollowUp: (...args: Parameters<typeof patchFollowUp>) => {
        if (isCurrent()) patchFollowUp(...args);
      },
      persist: async (agentId: string) => {
        if (isCurrent()) await persistFollowUpsForAgent(agentId);
      },
    };
  }, [patchAgent, patchFollowUp, persistFollowUpsForAgent]);

  // ── 发起首轮提问 ───────────────────────────────────────

  const sendQuestion = useCallback(
    async (question: string, apiConfig: ApiConfig, intent: IntentReference = {}): Promise<void> => {
      const session = captureSession();
      const trimmed = question.trim();
      if (!trimmed || isRunning || !sessionReady) return;

      const userMsg = makeUserMessage(trimmed);
      const agentMsg = makeAgentMessage();
      const readingId = genId();
      agentMsg.readingId = readingId;
      Object.assign(agentMsg, intent);
      const patchCurrent = (patch: Parameters<typeof patchAgent>[1]) =>
        session.patchAgent(agentMsg.id, patch);
      commit((prev) => [...prev, userMsg, agentMsg]);
      setIsRunning(true);

      const controller = createController();

      try {
        if (persistent) await persistSession();
        if (!session.isCurrent() || controller.signal.aborted) return;
        const createdAt = new Date();
        const result = await runAgentTurn({
          ...intent,
          readingId,
          question: trimmed,
          apiConfig,
          signal: controller.signal,
          callbacks: {
            onSpreadChosen: ({ spread, reason }) => patchCurrent({ spread, spreadReason: reason }),
            onCardsDrawn: async ({ drawnCards }) => {
              if (!session.isCurrent()) return;
              patchCurrent({ drawnCards });
              const current = messagesRef.current.find((message) => message.id === agentMsg.id);
              if (current?.role !== 'agent' || !current.spread) return;
              await saveReading({
                id: readingId,
                ...intent,
                question: trimmed,
                spread: current.spread,
                drawnCards,
                interpretation: '',
                createdAt,
              });
              patchCurrent({ readingId, readingSaved: true });
            },
            onContent: (chunk) => patchCurrent((prev) => ({ content: prev.content + chunk })),
            onThinking: (chunk) => patchCurrent((prev) => ({ content: prev.content + chunk })),
            onStreamError: (msg) => patchCurrent((prev) => ({ error: prev.error ?? msg })),
            onRetry: (attempt, max) => patchCurrent({ retry: { attempt, max }, content: '' }),
          },
        });

        // 持久化
        if (!session.isCurrent()) return;
        const reading: Reading = {
          id: readingId,
          ...intent,
          question: trimmed,
          spread: result.spread,
          drawnCards: result.drawnCards,
          interpretation: result.interpretation,
          createdAt,
        };
        patchCurrent((prev) => ({
          ...presentGeneration(result, result.interpretation, prev.error),
          content: result.interpretation,
          readingId,
          retry: null,
        }));
        const completedMessage = messagesRef.current.find((message) => message.id === agentMsg.id);
        if (completedMessage?.role === 'agent')
          reading.generationStatus = completedMessage.generationStatus;
        await persistGenerated(
          () => saveReading(reading),
          patchCurrent,
          presentGeneration({ ...result, persistenceStatus: 'saved' }, result.interpretation)
            .notice,
        );
      } catch (err) {
        if (err instanceof LLMError && err.info.code === 'ABORTED') {
          patchCurrent({
            status: 'error',
            generationStatus: 'cancelled',
            error: '已停止生成',
            retry: null,
          });
          return;
        }
        patchCurrent({ status: 'error', error: getErrorMessage(err), retry: null });
      } finally {
        if (session.isCurrent()) setIsRunning(false);
        if (activeAbortRef.current === controller) {
          activeAbortRef.current = null;
        }
      }
    },
    [captureSession, isRunning, sessionReady, persistent, persistSession, createController, commit],
  );

  // ── 发起追问 ───────────────────────────────────────────

  const askFollowUp = useCallback(
    async (
      question: string,
      apiConfig: ApiConfig,
      options?: { direct?: boolean; intentId?: string },
    ): Promise<void> => {
      const session = captureSession();
      const trimmed = question.trim();
      if (!trimmed || isRunning) return;

      // 找到最后一个 agent 消息作为追问的上下文
      const lastAgent = [...messagesRef.current].reverse().find((m) => m.role === 'agent');
      if (
        !lastAgent ||
        lastAgent.role !== 'agent' ||
        lastAgent.status !== 'done' ||
        !lastAgent.spread ||
        !lastAgent.content
      ) {
        return;
      }

      const followUp = makeFollowUpMessage(trimmed);
      followUp.intentId = options?.intentId;
      if (options?.direct) followUp.decision = 'direct';
      const targetAgentId = lastAgent.id;
      const originalQuestion = findOriginalQuestion(targetAgentId);

      commit((prev) => {
        let changed = false;
        const next = prev.map((message) => {
          if (message.role !== 'agent' || message.id !== targetAgentId) {
            return message;
          }

          changed = true;
          return { ...message, followUps: [...message.followUps, followUp] };
        });

        return changed ? next : prev;
      });

      setIsRunning(true);
      const controller = createController();

      try {
        await session.persist(targetAgentId);
        if (!session.isCurrent()) return;
        const result = await runFollowUpTurn({
          readingId: lastAgent.readingId ?? undefined,
          followUpId: followUp.id,
          intentId: followUp.intentId,
          direct: options?.direct,
          originalQuestion,
          spread: lastAgent.spread,
          drawnCards: lastAgent.drawnCards,
          previousInterpretation: lastAgent.content,
          followUpQuestion: trimmed,
          history: buildFollowUpHistory(lastAgent.followUps),
          apiConfig,
          signal: controller.signal,
          callbacks: {
            onDecided: (decision, drawCount, reason) =>
              session.patchFollowUp(followUp.id, { decision, drawCount, reason }),
            onSupplementaryCards: async (cards) => {
              if (!session.isCurrent()) return;
              session.patchFollowUp(followUp.id, { additionalCards: cards });
              await session.persist(targetAgentId);
            },
            onContent: (chunk) =>
              session.patchFollowUp(followUp.id, (prev) => ({
                interpretation: prev.interpretation + chunk,
              })),
            onThinking: (chunk) =>
              session.patchFollowUp(followUp.id, (prev) => ({
                interpretation: prev.interpretation + chunk,
              })),
            onStreamError: (msg) =>
              session.patchFollowUp(followUp.id, (prev) => ({ error: prev.error ?? msg })),
            onRetry: (attempt, max) =>
              session.patchFollowUp(followUp.id, { retry: { attempt, max }, interpretation: '' }),
          },
        });

        session.patchFollowUp(followUp.id, (prev) => ({
          ...presentGeneration(result, result.interpretation, prev.error),
          interpretation: result.interpretation,
          retry: null,
        }));

        if (!session.isCurrent()) return;

        // 持久化追问
        if (lastAgent.readingId) {
          await persistGenerated(
            () => session.persist(targetAgentId),
            (value) => session.patchFollowUp(followUp.id, value),
            presentGeneration({ ...result, persistenceStatus: 'saved' }, result.interpretation)
              .notice,
          );
        }
      } catch (err) {
        if (err instanceof LLMError && err.info.code === 'ABORTED') {
          session.patchFollowUp(followUp.id, {
            status: 'error',
            generationStatus: 'cancelled',
            error: '已停止生成',
            retry: null,
          });
          return;
        }
        session.patchFollowUp(followUp.id, {
          status: 'error',
          error: getErrorMessage(err),
          retry: null,
        });
      } finally {
        await persistGenerated(
          () => session.persist(targetAgentId),
          (value) => session.patchFollowUp(followUp.id, value),
        );
        if (session.isCurrent()) setIsRunning(false);
        if (activeAbortRef.current === controller) {
          activeAbortRef.current = null;
        }
      }
    },
    [captureSession, isRunning, createController, commit, findOriginalQuestion],
  );

  // ── 重新生成首轮回复 ─────────────────────────────────────

  const regenerateAgentMessage = useCallback(
    async (agentId: string, apiConfig: ApiConfig): Promise<void> => {
      const session = captureSession();
      if (isRunning) return;

      const target = messagesRef.current.find(
        (message) => message.role === 'agent' && message.id === agentId,
      );
      if (!target || target.role !== 'agent') return;

      const originalQuestion = findOriginalQuestion(agentId);
      if (!originalQuestion) return;

      const previousContent = target.content;
      const existingReadingId = target.readingId;
      const canReuseReading = Boolean(target.spread && target.drawnCards.length > 0);

      if (
        target.persistenceStatus === 'failed' &&
        target.generationStatus === 'completed' &&
        existingReadingId
      ) {
        await persistGenerated(
          () =>
            updateReadingInterpretation(
              existingReadingId,
              previousContent,
              target.generationStatus,
            ),
          (value) =>
            session.patchAgent(agentId, {
              ...value,
              ...(value.persistenceStatus === 'saved' ? { notice: null } : {}),
            }),
        );
        return;
      }

      session.patchAgent(agentId, {
        content: '',
        status: 'running',
        error: null,
        notice: null,
        retry: null,
        generationStatus: undefined,
        persistenceStatus: 'unknown',
        ...(canReuseReading
          ? {}
          : {
              spread: null,
              spreadReason: '',
              drawnCards: [],
              readingId: null,
              readingSaved: false,
            }),
      });
      setIsRunning(true);

      const controller = createController();

      try {
        if (target.spread && target.drawnCards.length > 0) {
          const savedId = existingReadingId ?? genId();
          if (!target.readingSaved) {
            await saveReading({
              id: savedId,
              question: originalQuestion,
              intentId: target.intentId,
              sceneId: target.sceneId,
              spread: target.spread,
              drawnCards: target.drawnCards,
              interpretation: previousContent,
              createdAt: new Date(),
            });
            session.patchAgent(agentId, { readingId: savedId, readingSaved: true });
          }
          if (!session.isCurrent()) return;
          const result = await rerunAgentInterpretation({
            intentId: target.intentId,
            sceneId: target.sceneId,
            readingId: savedId,
            question: originalQuestion,
            spread: target.spread,
            drawnCards: target.drawnCards,
            previousInterpretation: previousContent,
            apiConfig,
            signal: controller.signal,
            callbacks: {
              onContent: (chunk) =>
                session.patchAgent(agentId, (prev) => ({ content: prev.content + chunk })),
              onThinking: (chunk) =>
                session.patchAgent(agentId, (prev) => ({ content: prev.content + chunk })),
              onStreamError: (msg) =>
                session.patchAgent(agentId, (prev) => ({ error: prev.error ?? msg })),
              onRetry: (attempt, max) =>
                session.patchAgent(agentId, { retry: { attempt, max }, content: '' }),
            },
          });

          if (!session.isCurrent()) return;
          session.patchAgent(agentId, (prev) => ({
            ...presentGeneration(result, result.interpretation, prev.error),
            content: result.interpretation,
          }));
          const completedMessage = messagesRef.current.find((message) => message.id === agentId);
          const generationStatus =
            completedMessage?.role === 'agent'
              ? completedMessage.generationStatus
              : result.generationStatus;
          await persistGenerated(
            () => updateReadingInterpretation(savedId, result.interpretation, generationStatus),
            (value) => session.patchAgent(agentId, value),
            presentGeneration({ ...result, persistenceStatus: 'saved' }, result.interpretation)
              .notice,
          );
          return;
        }

        const readingId = existingReadingId ?? genId();
        session.patchAgent(agentId, { readingId });
        if (persistent) await persistSession();
        if (!session.isCurrent() || controller.signal.aborted) return;
        const result = await runAgentTurn({
          intentId: target.intentId,
          sceneId: target.sceneId,
          readingId,
          question: originalQuestion,
          apiConfig,
          signal: controller.signal,
          callbacks: {
            onSpreadChosen: ({ spread, reason }) =>
              session.patchAgent(agentId, { spread, spreadReason: reason }),
            onCardsDrawn: async ({ drawnCards }) => {
              if (!session.isCurrent()) return;
              session.patchAgent(agentId, { drawnCards });
              const current = messagesRef.current.find((message) => message.id === agentId);
              if (current?.role !== 'agent' || !current.spread) return;
              await saveReading({
                id: readingId,
                question: originalQuestion,
                intentId: target.intentId,
                sceneId: target.sceneId,
                spread: current.spread,
                drawnCards,
                interpretation: '',
                createdAt: new Date(),
              });
              session.patchAgent(agentId, { readingId, readingSaved: true });
            },
            onContent: (chunk) =>
              session.patchAgent(agentId, (prev) => ({ content: prev.content + chunk })),
            onThinking: (chunk) =>
              session.patchAgent(agentId, (prev) => ({ content: prev.content + chunk })),
            onStreamError: (msg) =>
              session.patchAgent(agentId, (prev) => ({ error: prev.error ?? msg })),
            onRetry: (attempt, max) =>
              session.patchAgent(agentId, { retry: { attempt, max }, content: '' }),
          },
        });

        if (!session.isCurrent()) return;
        const reading: Reading = {
          id: readingId,
          question: originalQuestion,
          intentId: target.intentId,
          sceneId: target.sceneId,
          spread: result.spread,
          drawnCards: result.drawnCards,
          interpretation: result.interpretation,
          createdAt: new Date(),
        };
        session.patchAgent(agentId, (prev) => ({
          ...presentGeneration(result, result.interpretation, prev.error),
          content: result.interpretation,
          readingId,
        }));
        const completedMessage = messagesRef.current.find((message) => message.id === agentId);
        if (completedMessage?.role === 'agent')
          reading.generationStatus = completedMessage.generationStatus;
        await persistGenerated(
          () => saveReading(reading),
          (value) => session.patchAgent(agentId, value),
          presentGeneration({ ...result, persistenceStatus: 'saved' }, result.interpretation)
            .notice,
        );
      } catch (err) {
        if (err instanceof LLMError && err.info.code === 'ABORTED') {
          session.patchAgent(agentId, {
            status: 'error',
            generationStatus: 'cancelled',
            error: '已停止生成',
          });
          return;
        }
        session.patchAgent(agentId, { status: 'error', error: getErrorMessage(err) });
      } finally {
        session.patchAgent(agentId, (prev) => ({
          retry: null,
          content: prev.content || previousContent,
        }));
        if (session.isCurrent()) setIsRunning(false);
        if (activeAbortRef.current === controller) {
          activeAbortRef.current = null;
        }
      }
    },
    [captureSession, isRunning, persistent, persistSession, createController, findOriginalQuestion],
  );

  // ── 重新生成追问回复 ─────────────────────────────────────

  const regenerateFollowUp = useCallback(
    async (agentId: string, followUpId: string, apiConfig: ApiConfig): Promise<void> => {
      const session = captureSession();
      if (isRunning) return;

      const agent = messagesRef.current.find(
        (message) => message.role === 'agent' && message.id === agentId,
      );
      if (!agent || agent.role !== 'agent' || !agent.spread || !agent.content) {
        return;
      }

      const followUp = agent.followUps.find((fu) => fu.id === followUpId);
      const originalQuestion = findOriginalQuestion(agentId);
      if (!followUp || !originalQuestion) return;

      const previousFollowUpInterpretation = followUp.interpretation;
      if (followUp.persistenceStatus === 'failed' && followUp.generationStatus === 'completed') {
        await persistGenerated(
          () => session.persist(agentId),
          (value) =>
            session.patchFollowUp(followUpId, {
              ...value,
              ...(value.persistenceStatus === 'saved' ? { notice: null } : {}),
            }),
        );
        return;
      }
      const canReuseDecision =
        followUp.decision !== null &&
        (followUp.decision === 'direct' || followUp.additionalCards.length > 0);

      session.patchFollowUp(followUpId, {
        status: 'running',
        error: null,
        notice: null,
        retry: null,
        interpretation: '',
        generationStatus: undefined,
        persistenceStatus: 'unknown',
        ...(canReuseDecision
          ? {}
          : {
              decision: null,
              drawCount: 0,
              reason: '',
              additionalCards: [],
            }),
      });
      setIsRunning(true);

      const controller = createController();

      try {
        if (canReuseDecision && followUp.decision) {
          const result = await rerunFollowUpInterpretation({
            readingId: agent.readingId ?? undefined,
            followUpId,
            intentId: followUp.intentId,
            sceneId: agent.sceneId,
            originalQuestion,
            spread: agent.spread,
            drawnCards: agent.drawnCards,
            previousInterpretation: agent.content,
            followUpQuestion: followUp.question,
            history: buildFollowUpHistory(agent.followUps, followUpId),
            decision: followUp.decision,
            additionalCards: followUp.additionalCards,
            previousFollowUpInterpretation,
            apiConfig,
            signal: controller.signal,
            callbacks: {
              onContent: (chunk) =>
                session.patchFollowUp(followUpId, (prev) => ({
                  interpretation: prev.interpretation + chunk,
                })),
              onThinking: (chunk) =>
                session.patchFollowUp(followUpId, (prev) => ({
                  interpretation: prev.interpretation + chunk,
                })),
              onStreamError: (msg) =>
                session.patchFollowUp(followUpId, (prev) => ({ error: prev.error ?? msg })),
              onRetry: (attempt, max) =>
                session.patchFollowUp(followUpId, { retry: { attempt, max }, interpretation: '' }),
            },
          });

          session.patchFollowUp(followUpId, (prev) => ({
            ...presentGeneration(result, result.interpretation, prev.error),
            interpretation: result.interpretation,
          }));
          await persistGenerated(
            () => session.persist(agentId),
            (value) => session.patchFollowUp(followUpId, value),
            presentGeneration({ ...result, persistenceStatus: 'saved' }, result.interpretation)
              .notice,
          );
          return;
        }

        const result = await runFollowUpTurn({
          readingId: agent.readingId ?? undefined,
          followUpId,
          intentId: followUp.intentId,
          sceneId: agent.sceneId,
          originalQuestion,
          spread: agent.spread,
          drawnCards: agent.drawnCards,
          previousInterpretation: agent.content,
          followUpQuestion: followUp.question,
          history: buildFollowUpHistory(agent.followUps, followUpId),
          apiConfig,
          signal: controller.signal,
          callbacks: {
            onDecided: (decision, drawCount, reason) =>
              session.patchFollowUp(followUpId, { decision, drawCount, reason }),
            onSupplementaryCards: async (cards) => {
              session.patchFollowUp(followUpId, { additionalCards: cards });
              await session.persist(agentId);
            },
            onContent: (chunk) =>
              session.patchFollowUp(followUpId, (prev) => ({
                interpretation: prev.interpretation + chunk,
              })),
            onThinking: (chunk) =>
              session.patchFollowUp(followUpId, (prev) => ({
                interpretation: prev.interpretation + chunk,
              })),
            onStreamError: (msg) =>
              session.patchFollowUp(followUpId, (prev) => ({ error: prev.error ?? msg })),
            onRetry: (attempt, max) =>
              session.patchFollowUp(followUpId, { retry: { attempt, max }, interpretation: '' }),
          },
        });

        session.patchFollowUp(followUpId, (prev) => ({
          ...presentGeneration(result, result.interpretation, prev.error),
          interpretation: result.interpretation,
        }));
        await persistGenerated(
          () => session.persist(agentId),
          (value) => session.patchFollowUp(followUpId, value),
          presentGeneration({ ...result, persistenceStatus: 'saved' }, result.interpretation)
            .notice,
        );
      } catch (err) {
        if (err instanceof LLMError && err.info.code === 'ABORTED') {
          session.patchFollowUp(followUpId, {
            status: 'error',
            generationStatus: 'cancelled',
            error: '已停止生成',
          });
          return;
        }
        session.patchFollowUp(followUpId, { status: 'error', error: getErrorMessage(err) });
      } finally {
        session.patchFollowUp(followUpId, (prev) => ({
          retry: null,
          interpretation: prev.interpretation || previousFollowUpInterpretation,
        }));
        await persistGenerated(
          () => session.persist(agentId),
          (value) => session.patchFollowUp(followUpId, value),
        );
        if (session.isCurrent()) setIsRunning(false);
        if (activeAbortRef.current === controller) {
          activeAbortRef.current = null;
        }
      }
    },
    [captureSession, isRunning, createController, findOriginalQuestion],
  );

  // ── 重置 ───────────────────────────────────────────────

  /** 重新抽牌开启新回合，原牌与原解读仍留在对话中。 */
  const redrawAgentMessage = useCallback(
    async (agentId: string, apiConfig: ApiConfig) => {
      const question = findOriginalQuestion(agentId);
      const original = messagesRef.current.find((message) => message.id === agentId);
      if (question)
        await sendQuestion(
          question,
          apiConfig,
          original?.role === 'agent'
            ? { intentId: original.intentId, sceneId: original.sceneId }
            : undefined,
        );
    },
    [findOriginalQuestion, sendQuestion],
  );

  const clearSession = useCallback(() => {
    preserveInterruptedFollowUps();
    sessionVersion.current += 1;
    cancel();
    commit(() => []);
    setIsRunning(false);
  }, [cancel, commit, preserveInterruptedFollowUps]);

  const reset = useCallback(() => {
    clearSession();
    void persistSession().catch(() => {});
  }, [clearSession, persistSession]);

  const readingMessages = useCallback(
    (reading: Reading, completion: ReadingCompletion = 'unknown'): ChatMessage[] => {
      const content = reading.interpretation ?? '';
      const quality = validateInterpretationQuality(content, {
        mode: 'initial',
        drawnCards: reading.drawnCards,
      });
      const incomplete =
        (reading.generationStatus
          ? reading.generationStatus !== 'completed'
          : completion === 'incomplete') ||
        !hasValidAnswer(content) ||
        quality.needsRetry;
      const agent: AgentMessage = {
        ...makeAgentMessage(),
        restored: true,
        content,
        intentId: reading.intentId,
        sceneId: reading.sceneId,
        spread: reading.spread,
        drawnCards: reading.drawnCards,
        readingId: reading.id,
        readingSaved: true,
        status: incomplete ? 'error' : 'done',
        generationStatus: reading.generationStatus,
        persistenceStatus: 'saved',
        error: incomplete
          ? (quality.issues.find((issue) => issue.severity === 'error')?.message ??
            '这份解读尚未完成，已保留内容和原牌，可重试解读。')
          : null,
        notice:
          !incomplete && !reading.generationStatus && completion === 'unknown'
            ? '这条历史的完成状态无法确认，以下为已保存内容；如内容不完整，可保留原牌重新解读。'
            : null,
        followUps: (reading.followUps ?? []).map((followUp) => ({
          ...followUp,
          restored: true,
          status:
            followUp.status === 'done' &&
            (!followUp.generationStatus || followUp.generationStatus === 'completed') &&
            !followUp.error &&
            hasValidAnswer(followUp.interpretation)
              ? 'done'
              : 'error',
          decision: followUp.decision ?? null,
          reason: followUp.reason ?? '',
          error:
            followUp.error ??
            (followUp.status !== 'done' || !hasValidAnswer(followUp.interpretation)
              ? '上次追问未完成，已保留内容和牌面。'
              : null),
          notice: null,
          retry: null,
        })),
      };
      return [makeUserMessage(reading.question), agent];
    },
    [],
  );

  const restoreReading = useCallback(
    (reading: Reading, completion: ReadingCompletion = 'unknown') => {
      clearSession();
      commit(() => readingMessages(reading, completion));
      void persistSession().catch(() => {});
    },
    [clearSession, commit, readingMessages, persistSession],
  );

  useEffect(() => {
    if (!persistent) return;
    const controller = new AbortController();
    sessionAbort.current = controller;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    clearSession();
    setSessionReady(false);
    setSessionError('');
    if (authenticated) {
      loadAgentSession()
        .then((result) => {
          if (controller.signal.aborted) return;
          revision.current = result.revision;
          commit(() =>
            result.tasks.flatMap((task: RestoredAgentTask): ChatMessage[] => {
              if (task.reading) {
                return readingMessages(task.reading, task.completion).map((message) =>
                  message.role === 'agent' ? { ...message, id: task.id } : message,
                );
              }
              return [
                makeUserMessage(task.question),
                {
                  ...makeAgentMessage(),
                  id: task.id,
                  readingId: task.readingId,
                  status: 'error',
                  restored: true,
                  error: '上次任务尚未完成抽牌，或记录已被删除。可以重新选阵与抽牌。',
                },
              ];
            }),
          );
          setSessionReady(true);
        })
        .catch((error) => {
          if (!controller.signal.aborted)
            setSessionError(error instanceof Error ? error.message : '读取对话失败，请刷新重试');
        });
    }
    return () => {
      controller.abort();
    };
  }, [authenticated, persistent, clearSession, commit, readingMessages]);

  // 返回同一记录时优先使用内存里的实时状态，不能用数据库快照重置活动流。
  const hasReading = useCallback(
    (readingId: string) =>
      messagesRef.current.some(
        (message) => message.role === 'agent' && message.readingId === readingId,
      ),
    [],
  );

  return {
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
    sessionReady,
    sessionError,
  };
}
