/**
 * 流式文本 UI 缓冲 — 把高频 token 回调合并成低频 setState。
 *
 * 思考模型每秒可能推送数十个 chunk；若每次都 setState + 全量 Markdown 重渲，
 * 长思考时主线程会被打满，神谕阶段表现为卡死 / 假死。
 *
 * 用法：
 *   const buf = createStreamTextBuffer((text) => setContent(text));
 *   onContent: (c) => buf.append(c)
 *   onThinking: (c) => buf.append(c)
 *   finally: buf.flush(); buf.dispose();
 */

export interface StreamTextBuffer {
  /** 追加一段文本（首段立即发布，后续按节流窗口刷到 UI） */
  append: (chunk: string) => void;
  /** 立刻把缓冲刷到 UI（流结束 / 出错时调用） */
  flush: () => void;
  /** 当前已累积的完整文本（含尚未 flush 的部分） */
  getText: () => string;
  /** 重置缓冲（不触发 onUpdate） */
  reset: () => void;
  /** 清理定时器；之后不应再 append */
  dispose: () => void;
}

export interface StreamTextBufferOptions {
  /**
   * 首段发布后，后续 UI 更新的节流窗口（毫秒）。
   * 默认 80ms ≈ 12fps，足够流畅且远低于 token 速率。
   */
  intervalMs?: number;
}

export function createStreamTextBuffer(
  onUpdate: (fullText: string) => void,
  options?: StreamTextBufferOptions,
): StreamTextBuffer {
  const intervalMs = options?.intervalMs ?? 80;
  let fullText = '';
  let pending = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const emit = (): void => {
    pending = false;
    timer = null;
    if (disposed) return;
    onUpdate(fullText);
  };

  const schedule = (): void => {
    if (pending || disposed) return;
    pending = true;
    timer = setTimeout(emit, intervalMs);
  };

  return {
    append(chunk: string): void {
      if (!chunk || disposed) return;
      const firstChunk = fullText.length === 0;
      fullText += chunk;
      if (firstChunk) emit();
      else schedule();
    },
    flush(): void {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      pending = false;
      if (disposed) return;
      onUpdate(fullText);
    },
    getText(): string {
      return fullText;
    },
    reset(): void {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      pending = false;
      fullText = '';
    },
    dispose(): void {
      disposed = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      pending = false;
    },
  };
}
