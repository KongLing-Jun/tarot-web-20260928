import { mergeSegments, parseInterpretationSegments } from '@/lib/interpretation';
import type { FollowUpHistoryEntry } from '@/lib/tarot/types';
import { hasValidAnswer, type GenerationStatus } from '@/lib/api/generation-result';

interface HistorySource extends FollowUpHistoryEntry {
  id: string;
  status: string;
  error: string | null;
  notice?: string | null;
  generationStatus?: GenerationStatus;
}

/** 保留目标轮之前的用户补充和实际补牌；仅完整有效的模型回答可进入上下文。 */
export function buildFollowUpHistory(
  followUps: HistorySource[],
  beforeId?: string,
): FollowUpHistoryEntry[] {
  const end =
    beforeId === undefined
      ? followUps.length
      : followUps.findIndex((entry) => entry.id === beforeId);
  if (end < 0) return [];
  return followUps.slice(0, end).map((entry) => {
    const completed =
      entry.status === 'done' &&
      !entry.error &&
      (entry.generationStatus ? entry.generationStatus === 'completed' : !entry.notice);
    const answer = completed
      ? mergeSegments(parseInterpretationSegments(entry.interpretation)).answer
      : '';
    return {
      question: entry.question,
      interpretation: hasValidAnswer(answer) ? answer : '',
      additionalCards: entry.additionalCards,
    };
  });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/** 校验新增 API 字段，避免畸形历史牌面进入 prompt 构建。 */
export function isFollowUpHistory(value: unknown): value is FollowUpHistoryEntry[] {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        isObject(entry) &&
        typeof entry.question === 'string' &&
        typeof entry.interpretation === 'string' &&
        Array.isArray(entry.additionalCards) &&
        entry.additionalCards.every((drawn) => {
          if (
            !isObject(drawn) ||
            typeof drawn.isReversed !== 'boolean' ||
            !isObject(drawn.card) ||
            !isObject(drawn.position)
          )
            return false;
          const { card, position } = drawn;
          return (
            ['id', 'name', 'nameCn', 'image'].every((key) => typeof card[key] === 'string') &&
            (card.type === 'major' || card.type === 'minor') &&
            (card.suit === undefined ||
              ['wands', 'cups', 'swords', 'pentacles'].includes(card.suit as string)) &&
            typeof card.number === 'number' &&
            Number.isFinite(card.number) &&
            isObject(card.keywords) &&
            isStringArray(card.keywords.upright) &&
            isStringArray(card.keywords.reversed) &&
            isObject(card.meaning) &&
            typeof card.meaning.upright === 'string' &&
            typeof card.meaning.reversed === 'string' &&
            ['id', 'name', 'nameCn', 'description'].every(
              (key) => typeof position[key] === 'string',
            )
          );
        }),
    )
  );
}
