import {
  classifyGeneration,
  type GenerationStatus,
  type PersistenceStatus,
} from './generation-result';
import type { InterpretationQualityResult } from '@/lib/interpretation-quality';

/** Keep the visible state consistent across manual, agent and daily readings. */
export interface GenerationOutcome {
  generationStatus?: GenerationStatus;
  persistenceStatus?: PersistenceStatus;
  receivedError?: boolean;
  truncated?: boolean;
  finishReason?: string | null;
  quality?: InterpretationQualityResult;
  decisionFallbackReason?: string;
}

export function presentGeneration(
  result: GenerationOutcome,
  fullText: string,
  streamError?: string | null,
) {
  const generationStatus =
    result.generationStatus ??
    classifyGeneration({
      fullText,
      done: !result.receivedError && !streamError,
      interrupted: Boolean(result.receivedError || streamError),
      truncated: result.truncated,
      finishReason: result.finishReason ?? undefined,
    });
  const errors: Partial<Record<GenerationStatus, string>> = {
    'no-valid-answer': '未收到有效解读内容，请保留原牌重试。',
    interrupted: '回复传输中断，已保留当前内容，可保留原牌重试。',
    cancelled: '已停止生成，已保留当前内容和原牌。',
    truncated: '回复因模型输出长度限制被截断，已显示部分内容。',
  };
  const qualityNotice = result.quality?.issues
    .filter((issue) => issue.severity === 'warning')
    .map((issue) => issue.message)
    .join(' ');
  const fallbackNotice = result.decisionFallbackReason
    ? '自动决策未能确认，已按页面展示的默认方案继续。'
    : null;
  return {
    generationStatus,
    persistenceStatus: result.persistenceStatus ?? ('unknown' as PersistenceStatus),
    status:
      generationStatus === 'completed' && !result.quality?.needsRetry
        ? ('done' as const)
        : ('error' as const),
    error:
      generationStatus === 'completed'
        ? (result.quality?.issues.find((issue) => issue.severity === 'error')?.message ?? null)
        : (streamError ?? errors[generationStatus] ?? null),
    notice:
      result.persistenceStatus === 'failed'
        ? '解读内容已保留，但历史记录保存失败；重试会先补存当前内容。'
        : result.persistenceStatus === 'unknown' && result.generationStatus
          ? '已保留当前内容，但历史记录保存状态尚未确认。'
          : generationStatus === 'truncated'
            ? errors.truncated!
            : [qualityNotice, fallbackNotice].filter(Boolean).join(' ') || null,
  };
}
