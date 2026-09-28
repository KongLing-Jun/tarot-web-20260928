import { allCards } from '@/lib/tarot/cards';
import { getSpreadById } from '@/lib/tarot/spreads';
import type { DrawnCard, FollowUp, Reading } from '@/lib/tarot/types';
import { hasValidAnswer, type GenerationStatus } from '@/lib/api/generation-result';
import { HttpError } from './http';

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new HttpError(400, '记录格式错误');
  return value as Record<string, unknown>;
}

function text(value: unknown, max = 500000): string {
  if (typeof value !== 'string' || value.length > max) throw new HttpError(400, '记录文本格式错误');
  return value;
}

function generationStatus(
  value: unknown,
  interpretation: string,
): Exclude<GenerationStatus, 'running'> {
  if (
    !['completed', 'truncated', 'interrupted', 'cancelled', 'no-valid-answer'].includes(
      value as string,
    )
  ) {
    throw new HttpError(400, '解读生成状态无效');
  }
  if (value === 'completed' && !hasValidAnswer(interpretation)) {
    throw new HttpError(400, '完整解读必须包含有效正文');
  }
  return value as Exclude<GenerationStatus, 'running'>;
}

export function recordId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value))
    throw new HttpError(400, '记录 ID 无效');
  return value;
}

export function parseDrawnCards(value: unknown): DrawnCard[] {
  if (!Array.isArray(value) || value.length > 10) throw new HttpError(400, '牌面格式错误');
  return value.map((item) => {
    const entry = object(item);
    const card = allCards.find((card) => card.id === object(entry.card).id);
    const position = object(entry.position);
    if (!card || typeof entry.isReversed !== 'boolean') throw new HttpError(400, '牌面无效');
    return {
      card,
      isReversed: entry.isReversed,
      position: {
        id: recordId(position.id),
        name: text(position.name, 200),
        nameCn: text(position.nameCn, 200),
        description: text(position.description, 2000),
      },
    };
  });
}

export function parseFollowUps(value: unknown): FollowUp[] {
  if (!Array.isArray(value) || value.length > 200) throw new HttpError(400, '追问格式错误');
  return value.map((item) => {
    const entry = object(item);
    if (
      !['deciding', 'awaiting-draw', 'awaiting-reveal', 'interpreting', 'done', 'error'].includes(
        entry.status as string,
      ) ||
      !['direct', 'draw', undefined].includes(entry.decision as string | undefined)
    )
      throw new HttpError(400, '追问状态错误');
    const cards = parseDrawnCards(entry.additionalCards);
    const interpretation = text(entry.interpretation);
    return {
      id: recordId(entry.id),
      ...(entry.intentId === undefined ? {} : { intentId: recordId(entry.intentId) }),
      question: text(entry.question, 10000),
      status: entry.status as FollowUp['status'],
      decision: entry.decision as FollowUp['decision'],
      drawCount: cards.length,
      reason: entry.reason === undefined ? undefined : text(entry.reason, 2000),
      additionalCards: cards,
      revealedCount: cards.length,
      interpretation,
      ...(entry.generationStatus === undefined
        ? {}
        : { generationStatus: generationStatus(entry.generationStatus, interpretation) }),
      error: entry.error == null ? null : text(entry.error, 2000),
    };
  });
}

export function parseReading(value: unknown): Reading {
  const entry = object(value);
  const spread = getSpreadById(text(object(entry.spread).id, 100));
  const createdAt = new Date(text(entry.createdAt, 100));
  if (!spread || !Number.isFinite(createdAt.getTime())) throw new HttpError(400, '牌阵或时间无效');
  const interpretation = entry.interpretation === undefined ? '' : text(entry.interpretation);
  return {
    id: recordId(entry.id),
    ...(entry.intentId === undefined ? {} : { intentId: recordId(entry.intentId) }),
    ...(entry.sceneId === undefined ? {} : { sceneId: recordId(entry.sceneId) }),
    question: text(entry.question, 10000),
    spread,
    drawnCards: parseDrawnCards(entry.drawnCards),
    createdAt,
    interpretation,
    ...(entry.generationStatus === undefined
      ? {}
      : { generationStatus: generationStatus(entry.generationStatus, interpretation) }),
    followUps: parseFollowUps(entry.followUps ?? []),
  };
}

export function parseReadingPatch(body: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if ('interpretation' in body) patch.interpretation = text(body.interpretation);
  if ('generationStatus' in body) {
    if (!('interpretation' in body)) throw new HttpError(400, '更新生成状态必须同时提供解读正文');
    patch.generationStatus = generationStatus(
      body.generationStatus,
      patch.interpretation as string,
    );
  }
  if ('followUps' in body) patch.followUps = parseFollowUps(body.followUps);
  if (!Object.keys(patch).length) throw new HttpError(400, '缺少更新内容');
  return patch;
}
