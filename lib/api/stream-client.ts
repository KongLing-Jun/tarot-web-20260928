/**
 * 统一 SSE 流客户端 - 面向前端的 /api/interpret 调用封装
 *
 * 特性:
 * - AbortController 支持(用户取消 + 组件卸载清理)
 * - 可配置的连接超时 & 流空闲超时
 * - 自动重试(仅对可重试错误,最多 N 次,指数退退)
 * - 结构化错误(集成 errors.ts 分类)
 * - 与 sseUtils.ts 解耦:仅负责传输层,解析由调用方传入
 */

import { classifyHttpError, classifyError, LLMError } from './errors';
import type { LLMErrorInfo } from './errors';
import { createSseDecoder, parseSseChunk, type ParsedSseChunk } from '@/lib/tarot/sseUtils';
import { parseReadingContent } from '@/lib/interpretation';
import { genId } from '@/lib/id';
import {
  classifyGeneration,
  hasValidAnswer,
  type GenerationStatus,
  type PersistenceStatus,
} from './generation-result';

// ─── 配置 ───────────────────────────────────────────────────────

export interface StreamClientConfig {
  /** 初始 fetch 的超时(毫秒)，缺省读取服务端运行时配置。 */
  connectTimeoutMs?: number;
  /**
   * 流中两次下行字节之间的最大空闲时间(毫秒)。
   * 服务端会以 ~15s 间隔发送 SSE 心跳注释，因此此值只需覆盖「心跳丢失」窗口，
   * 缺省值与服务端输出超时、心跳间隔一起下发。
   */
  streamIdleTimeoutMs?: number;
  /** 最大有效模型输出间隔；心跳不延长该预算。 */
  progressTimeoutMs?: number;
  /** 整次操作的预算，包括自动重试和退避。 */
  totalTimeoutMs?: number;
  /** 最大自动重试次数(仅对 retryable 错误)，缺省读取服务端配置。 */
  maxRetries?: number;
  /** 重试间隔的基数(毫秒),实际间隔 = base * 2^attempt。 */
  retryBaseMs?: number;
  /** 外部传入的 AbortSignal,用于取消 */
  signal?: AbortSignal;
}

type ResolvedConfig = Required<Omit<StreamClientConfig, 'signal'>>;
const CONFIG_KEYS = [
  'connectTimeoutMs',
  'streamIdleTimeoutMs',
  'progressTimeoutMs',
  'totalTimeoutMs',
  'maxRetries',
  'retryBaseMs',
] as const;

async function resolveConfig(config?: StreamClientConfig): Promise<ResolvedConfig> {
  let settings: Partial<ResolvedConfig> = {};
  if (CONFIG_KEYS.some((key) => config?.[key] === undefined)) {
    const response = await fetch('/api/interpret/config', {
      signal: config?.signal,
      cache: 'no-store',
    });
    if (!response.ok) throw new LLMError(classifyHttpError(response.status));
    settings = await response.json();
  }
  const resolved = {} as ResolvedConfig;
  for (const key of CONFIG_KEYS) {
    const value = config?.[key] ?? settings[key];
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value < (key === 'maxRetries' ? 0 : 1) ||
      (key === 'maxRetries' && !Number.isInteger(value))
    ) {
      throw new LLMError({
        code: 'BAD_REQUEST',
        message: 'AI 请求预算配置无效，请联系管理员',
        retryable: false,
      });
    }
    resolved[key] = value;
  }
  return resolved;
}

// ─── 重试状态 ─────────────────────────────────────────────────

/** 一次自动重试的瞬时状态 · 供 UI 显示「正在重试 N/M」 */
export interface RetryState {
  /** 当前第几次重试（从 1 开始） */
  attempt: number;
  /** 最大重试次数 */
  max: number;
}

// ─── 回调接口 ─────────────────────────────────────────────────

export interface StreamCallbacks {
  /** 收到正文 content chunk */
  onContent?: (chunk: string) => void;
  /** 收到 thinking/reasoning chunk */
  onThinking?: (chunk: string) => void;
  /** 收到 SSE 级别的 error 字段 */
  onStreamError?: (msg: string) => void;
  /** 重试时通知（可用于 UI 显示“正在重试…”） */
  onRetry?: (attempt: number, maxRetries: number) => void;
  /** 模型因 token 上限截断时通知 */
  onTruncated?: () => void;
  onPersistence?: (status: PersistenceStatus) => void;
}

// ─── 结果 ─────────────────────────────────────────────────────

export interface StreamResult {
  /** 累积的全部文本（content + thinking 交织，含 <think> 标签） */
  fullText: string;
  /** 是否使用了服务端后备配置 */
  usingFallback: boolean;
  /** 是否收到过 SSE error 字段 */
  receivedError: boolean;
  /** 是否因 token 上限被截断 */
  truncated: boolean;
  answer?: string;
  thinking?: string;
  finishReason?: string;
  generationStatus?: GenerationStatus;
  persistenceStatus?: PersistenceStatus;
  /** 协议诊断计数，不包含用户正文或模型推理。 */
  malformedEvents?: number;
}

// ─── 主函数 ───────────────────────────────────────────────────

/**
 * 向 /api/interpret 发起流式请求,消费 SSE 并通过回调推送。
 * 支持超时、重试、取消。
 *
 * @throws {LLMError} 当所有重试耗尽仍然失败
 */
export async function streamInterpret(
  body: unknown,
  callbacks: StreamCallbacks,
  config?: StreamClientConfig,
): Promise<StreamResult> {
  if (config?.signal?.aborted) {
    throw new LLMError({ code: 'ABORTED', message: '已取消请求', retryable: false });
  }
  const cfg = await resolveConfig(config);
  const budget = new AbortController();
  const userSignal = config?.signal;
  const cancel = (): void => budget.abort();
  if (userSignal?.aborted) cancel();
  userSignal?.addEventListener('abort', cancel, { once: true });
  const totalTimer = setTimeout(cancel, cfg.totalTimeoutMs);
  const externalSignal = budget.signal;
  const operationId = genId();

  let lastError: LLMErrorInfo | null = null;

  try {
    for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
      // 如果外部已取消,立即退出
      if (externalSignal?.aborted) {
        throw new LLMError({
          code: 'ABORTED',
          message: '已取消请求',
          retryable: false,
        });
      }

      // 非首次尝试时等待退避
      if (attempt > 0) {
        callbacks.onRetry?.(attempt, cfg.maxRetries);
        const delay = cfg.retryBaseMs * Math.pow(2, attempt - 1);
        await sleep(delay, externalSignal);
      }

      try {
        const payload = body && typeof body === 'object' ? body : {};
        const result = await doStreamRequest(
          { ...payload, operationId, attemptId: genId() },
          callbacks,
          cfg,
          externalSignal,
        );
        return result;
      } catch (err) {
        const info = err instanceof LLMError ? err.info : classifyError(err);

        // 不可重试 or 已用完重试次数 → 直接抛出
        if (!info.retryable || attempt >= cfg.maxRetries) {
          throw err instanceof LLMError ? err : new LLMError(info);
        }

        lastError = info;
        // 继续下一次重试
      }
    }

    // 理论上不会走到这里,但 TS 要求
    throw new LLMError(
      lastError ?? {
        code: 'UNKNOWN',
        message: '发生未知错误',
        retryable: false,
      },
    );
  } catch (error) {
    if (externalSignal.aborted) {
      throw new LLMError(
        userSignal?.aborted
          ? { code: 'ABORTED', message: '已取消请求', retryable: false }
          : {
              code: 'TIMEOUT',
              message: '本次解读已达到请求时间上限，已保留收到的内容',
              retryable: false,
            },
      );
    }
    throw error;
  } finally {
    clearTimeout(totalTimer);
    userSignal?.removeEventListener('abort', cancel);
  }
}

// ─── 内部:单次流请求 ─────────────────────────────────────────

async function doStreamRequest(
  body: unknown,
  callbacks: StreamCallbacks,
  cfg: ResolvedConfig,
  externalSignal?: AbortSignal,
): Promise<StreamResult> {
  // 组合 AbortController:连接超时 + 外部取消
  const controller = new AbortController();
  const { signal } = controller;

  // 联动外部信号
  const onExternalAbort = (): void => controller.abort();
  externalSignal?.addEventListener('abort', onExternalAbort);

  // 连接超时定时器
  const connectTimer = setTimeout(() => controller.abort(), cfg.connectTimeoutMs);

  let response: Response;

  try {
    response = await fetch('/api/interpret', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Older callers may still pass apiConfig; never send provider credentials.
      body: JSON.stringify(body, (key, value) => (key === 'apiConfig' ? undefined : value)),
      signal,
    });
  } catch (err) {
    clearTimeout(connectTimer);
    externalSignal?.removeEventListener('abort', onExternalAbort);

    // AbortError 要区分是超时还是用户取消
    if (err instanceof DOMException && err.name === 'AbortError') {
      if (externalSignal?.aborted) {
        throw new LLMError({ code: 'ABORTED', message: '已取消请求', retryable: false });
      }
      throw new LLMError({
        code: 'TIMEOUT',
        message: '连接超时,请检查网络或稍后重试',
        retryable: true,
      });
    }
    throw err; // TypeError (network) 等,由上层 classifyError 处理
  }

  // HTTP 错误
  if (!response.ok) {
    try {
      const errorBody = await readErrorBody(response, signal);
      throw new LLMError(classifyHttpError(response.status, errorBody));
    } finally {
      clearTimeout(connectTimer);
      externalSignal?.removeEventListener('abort', onExternalAbort);
    }
  }
  clearTimeout(connectTimer);

  const usingFallback = response.headers.get('X-Using-Fallback') === 'true';
  const reader = response.body?.getReader();

  if (!reader) {
    externalSignal?.removeEventListener('abort', onExternalAbort);
    throw new LLMError({
      code: 'STREAM_INTERRUPTED',
      message: '无法读取响应流',
      retryable: true,
    });
  }
  const cancelReader = (): void => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener('abort', cancelReader, { once: true });

  // ─── 流消费 ───
  const decoder = new TextDecoder();
  const events = createSseDecoder();
  let fullText = '';
  let streamComplete = false;
  let receivedError = false;
  let truncated = false;
  let finishReason: string | undefined;
  let persistenceStatus: PersistenceStatus = 'unknown';
  let malformedEvents = 0;
  let thinkingBlockOpen = false;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let progressTimer: ReturnType<typeof setTimeout> | null = null;
  const resetProgressTimer = (): void => {
    if (progressTimer) clearTimeout(progressTimer);
    progressTimer = setTimeout(() => controller.abort(), cfg.progressTimeoutMs);
  };

  // 回调节流：长思考时 token 极密，逐 chunk 触发 React setState 会卡死 UI。
  // fullText 仍即时累积；仅对 onContent / onThinking 做合并派发。
  type PendingKind = 'thinking' | 'content';
  const pendingEvents: Array<{ kind: PendingKind; text: string }> = [];
  let callbackFlushTimer: ReturnType<typeof setTimeout> | null = null;
  let hasAnswerContent = false;
  const CALLBACK_FLUSH_MS = 80;

  const flushCallbacks = (): void => {
    if (callbackFlushTimer) {
      clearTimeout(callbackFlushTimer);
      callbackFlushTimer = null;
    }
    if (pendingEvents.length === 0) return;
    const batch = pendingEvents.splice(0, pendingEvents.length);
    for (const event of batch) {
      if (event.kind === 'thinking') callbacks.onThinking?.(event.text);
      else callbacks.onContent?.(event.text);
    }
  };

  const enqueueCallback = (kind: PendingKind, text: string): void => {
    if (!text) return;
    const last = pendingEvents.at(-1);
    if (last && last.kind === kind) {
      last.text += text;
    } else {
      pendingEvents.push({ kind, text });
    }
    if (!callbackFlushTimer) {
      callbackFlushTimer = setTimeout(flushCallbacks, CALLBACK_FLUSH_MS);
    }
  };

  const append = (chunk: string): void => {
    if (!chunk) return;
    fullText += chunk;
  };

  const openThinking = (): void => {
    if (thinkingBlockOpen) return;
    const prefix = fullText ? '\n\n<think>\n' : '<think>\n';
    append(prefix);
    enqueueCallback('thinking', prefix);
    thinkingBlockOpen = true;
  };

  const closeThinking = (): void => {
    if (!thinkingBlockOpen) return;
    const suffix = '\n</think>\n\n';
    append(suffix);
    enqueueCallback('thinking', suffix);
    thinkingBlockOpen = false;
  };

  const processChunk = (parsed: ParsedSseChunk): void => {
    if (parsed.persistence) {
      persistenceStatus = parsed.persistence;
      callbacks.onPersistence?.(persistenceStatus);
    }
    if (parsed.malformed) malformedEvents++;
    if (parsed.finishReason) finishReason = parsed.finishReason;
    if (parsed.isDone) {
      streamComplete = true;
      closeThinking();
    }
    if (parsed.groundingProgress || parsed.thinking.trim() || parsed.content.trim())
      resetProgressTimer();
    if (parsed.thinking) {
      openThinking();
      append(parsed.thinking);
      enqueueCallback('thinking', parsed.thinking);
    }
    if (parsed.content) {
      closeThinking();
      append(parsed.content);
      enqueueCallback('content', parsed.content);
      // Show the first answer immediately; reasoning and whitespace do not consume this path.
      if (!hasAnswerContent && parsed.content.trim()) {
        hasAnswerContent = true;
        flushCallbacks();
      }
    }
    if (parsed.error) {
      receivedError = true;
      // 错误立即派发，不进节流队列
      flushCallbacks();
      callbacks.onStreamError?.(parsed.error);
    }
    if (parsed.truncated) {
      truncated = true;
      callbacks.onTruncated?.();
    }
  };

  const resetIdleTimer = (): void => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      // 流空闲超时 → 中止（服务端心跳会重置此计时器，因此只在连接真正假死时触发）
      controller.abort();
    }, cfg.streamIdleTimeoutMs);
  };

  try {
    resetIdleTimer();
    resetProgressTimer();

    while (true) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      const { done, value } = await reader.read();
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      if (done) break;

      // 任何下行字节都重置空闲计时（含 SSE 心跳注释 `: keepalive`）
      resetIdleTimer();
      for (const data of events.push(decoder.decode(value, { stream: true })))
        processChunk(parseSseChunk(data));
      // The server may acknowledge persistence after the provider's terminal event.
      if ((streamComplete || finishReason) && persistenceStatus !== 'unknown') break;
    }

    // 处理缓冲区残余
    for (const data of [...events.push(decoder.decode()), ...events.finish()])
      processChunk(parseSseChunk(data));

    closeThinking();
    flushCallbacks();
  } catch (err) {
    closeThinking();
    flushCallbacks();

    if ((streamComplete || finishReason) && !receivedError) {
      // Generation is already terminal. Loss of the persistence acknowledgement
      // cannot turn a complete answer into a new model request.
      persistenceStatus = 'unknown';
    } else if (err instanceof DOMException && err.name === 'AbortError') {
      if (externalSignal?.aborted) {
        throw new LLMError({ code: 'ABORTED', message: '已取消请求', retryable: false });
      }
      // 空闲超时导致的中止
      if (hasValidAnswer(fullText)) {
        // 已收到部分内容,当作流中断(不重试,返回已有内容)
        receivedError = true;
        callbacks.onStreamError?.('解读传输中断,已显示部分内容');
      } else {
        throw new LLMError({
          code: 'TIMEOUT',
          message: '响应超时,未收到任何内容',
          detail: `空闲超时 ${cfg.streamIdleTimeoutMs}ms`,
          retryable: true,
        });
      }
    } else {
      // 流读取出错但已有部分内容
      if (hasValidAnswer(fullText)) {
        receivedError = true;
        callbacks.onStreamError?.('解读传输中断');
      } else {
        throw err;
      }
    }
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
    if (progressTimer) clearTimeout(progressTimer);
    if (callbackFlushTimer) clearTimeout(callbackFlushTimer);
    signal.removeEventListener('abort', cancelReader);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
    externalSignal?.removeEventListener('abort', onExternalAbort);
  }

  if (!hasValidAnswer(fullText) && !streamComplete && !finishReason && !receivedError) {
    throw new LLMError({
      code: 'STREAM_INTERRUPTED',
      message: '响应提前结束，未收到有效正文',
      retryable: true,
    });
  }
  const generationStatus = classifyGeneration({
    fullText,
    finishReason,
    done: streamComplete,
    interrupted: receivedError,
    truncated,
  });
  if (generationStatus === 'interrupted' || generationStatus === 'no-valid-answer') {
    if (!receivedError)
      callbacks.onStreamError?.(
        generationStatus === 'no-valid-answer'
          ? '未收到有效解读正文，请重试'
          : '解读未完整结束，已保留收到的内容',
      );
    receivedError = true;
  }
  const { answer, thinking } = parseReadingContent(fullText);
  return {
    fullText,
    usingFallback,
    receivedError,
    truncated,
    answer,
    thinking,
    generationStatus,
    persistenceStatus,
    finishReason,
    malformedEvents,
  };
}

// ─── 工具 ────────────────────────────────────────────────────

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new LLMError({ code: 'ABORTED', message: '已取消请求', retryable: false }));
      return;
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new LLMError({ code: 'ABORTED', message: '已取消请求', retryable: false }));
    };

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Error responses need the same cancellation deadline as successful streams. */
async function readErrorBody(response: Response, signal: AbortSignal): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const cancel = (): void => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener('abort', cancel, { once: true });
  const decoder = new TextDecoder();
  let text = '';
  try {
    while (!signal.aborted) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    if (signal.aborted)
      throw new LLMError({ code: 'TIMEOUT', message: '读取服务响应超时', retryable: true });
    return text + decoder.decode();
  } finally {
    signal.removeEventListener('abort', cancel);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
