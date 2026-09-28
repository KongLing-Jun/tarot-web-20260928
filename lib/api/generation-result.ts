import { parseReadingContent } from '@/lib/interpretation';

export type GenerationStatus =
  'running' | 'completed' | 'truncated' | 'interrupted' | 'cancelled' | 'no-valid-answer';
export type PersistenceStatus = 'unknown' | 'saved' | 'failed';

/** Transport success requires actual answer text; reasoning and empty headings are not answers. */
export function hasValidAnswer(fullText: string): boolean {
  const { answer } = parseReadingContent(fullText);
  return Boolean(answer.replace(/^\s{0,3}#{1,6}\s+.*$/gm, '').replace(/[\s\p{P}\p{S}]/gu, ''));
}

export function classifyGeneration(input: {
  fullText: string;
  finishReason?: string;
  done?: boolean;
  interrupted?: boolean;
  cancelled?: boolean;
  truncated?: boolean;
}): Exclude<GenerationStatus, 'running'> {
  if (input.cancelled) return 'cancelled';
  if (!hasValidAnswer(input.fullText)) return 'no-valid-answer';
  if (input.truncated || input.finishReason === 'length') return 'truncated';
  if (input.interrupted) return 'interrupted';
  // Tool calls, filtering and unknown provider reasons cannot complete a text reading.
  if (input.finishReason && input.finishReason !== 'stop') return 'interrupted';
  return input.done || input.finishReason === 'stop' ? 'completed' : 'interrupted';
}
