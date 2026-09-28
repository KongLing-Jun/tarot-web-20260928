import { randomUUID } from 'node:crypto';
import { INTENT_VERSION, type IntentRequest, type IntentSnapshot } from '@/lib/intent/types';
import { parseIntentCandidate, createResponsePlan } from '@/lib/intent/policy';
import { buildIntentExtractionMessages } from '@/lib/intent/prompts';
import { readingScenes } from '@/lib/readingEntry';
import { countQuestionCharacters, QUESTION_MAX_CHARACTERS } from '@/lib/questionInput';
import {
  getModelConfig,
  getModelGenerationOptions,
  getServerNumber,
} from '@/lib/api/server-config';
import { getStreamSettings } from '@/lib/api/stream-settings';
import { HttpError } from './http';
import { recordId } from './readings';
import {
  getIntentSnapshot,
  getOwnedIntentReading,
  getReadingIntentContext,
  saveIntentSnapshot,
} from './intent-store';

export const loadOwnedIntent = getIntentSnapshot;

export function parseIntentRequest(value: Record<string, unknown>): IntentRequest {
  // Match parseFollowUps' existing text limit for persisted follow-up questions.
  const questionLimit = value.readingId === undefined ? QUESTION_MAX_CHARACTERS : 10000;
  if (
    typeof value.question !== 'string' ||
    !value.question.trim() ||
    (value.readingId === undefined
      ? countQuestionCharacters(value.question)
      : value.question.length) > questionLimit
  )
    throw new HttpError(400, `问题不能为空且不能超过 ${questionLimit} 字`);
  if (value.sceneId !== undefined && !readingScenes.some((scene) => scene.id === value.sceneId))
    throw new HttpError(400, '场景无效');
  for (const field of ['readingId', 'previousIntentId'] as const)
    if (value[field] !== undefined) recordId(value[field]);
  return {
    question: value.question,
    ...(value.sceneId === undefined ? {} : { sceneId: value.sceneId as string }),
    ...(value.readingId === undefined ? {} : { readingId: value.readingId as string }),
    ...(value.previousIntentId === undefined
      ? {}
      : { previousIntentId: value.previousIntentId as string }),
  };
}

export async function analyzeIntent(
  userId: string,
  request: IntentRequest,
  signal?: AbortSignal,
): Promise<IntentSnapshot> {
  const input = parseIntentRequest({ ...request });
  const reading = input.readingId
    ? await getReadingIntentContext(userId, input.readingId)
    : undefined;
  if (
    input.sceneId !== undefined &&
    reading?.sceneId !== undefined &&
    input.sceneId !== reading.sceneId
  )
    throw new HttpError(409, '场景与占卜记录不一致');
  input.sceneId ??= reading?.sceneId;
  const hasExistingCards = reading?.hasExistingCards ?? false;
  const previous = input.previousIntentId
    ? await getIntentSnapshot(userId, input.previousIntentId)
    : undefined;
  if (
    previous &&
    (previous.version !== INTENT_VERSION ||
      previous.sceneId !== input.sceneId ||
      previous.readingId !== input.readingId)
  )
    throw new HttpError(409, '意图上下文已变化，请重新识别');
  const history = reading?.messages ?? [];
  const messages = [
    ...new Map(
      [...history, ...(previous?.messages ?? [])].map((message) => [message.id, message]),
    ).values(),
    { id: randomUUID(), text: input.question },
  ];
  const config = getModelConfig();
  if (!config) throw new HttpError(503, '意图识别暂不可用，请稍后重试');
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(abort, getStreamSettings().upstreamTimeoutMs);
  try {
    controller.signal.throwIfAborted();
    const endpoint = config.endpoint.replace(/\/+$/, '');
    const response = await fetch(
      endpoint.includes('/chat/completions') ? endpoint : `${endpoint}/chat/completions`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
        signal: controller.signal,
        body: JSON.stringify({
          model: config.model,
          messages: buildIntentExtractionMessages(messages, input.sceneId, { hasExistingCards }),
          ...getModelGenerationOptions(config.endpoint),
          max_tokens: getServerNumber('MAX_OUTPUT_TOKENS'),
          stream: false,
        }),
      },
    );
    if (!response.ok) throw new Error('UpstreamUnavailable');
    const result = await response.json();
    const choice = result?.choices?.[0];
    if (choice?.finish_reason !== 'stop' || typeof choice?.message?.content !== 'string')
      throw new Error('IncompleteIntent');
    const content = choice.message.content
      .trim()
      .replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/, '$1');
    const candidate = parseIntentCandidate(JSON.parse(content), messages);
    const snapshot: IntentSnapshot = {
      id: randomUUID(),
      version: INTENT_VERSION,
      revision: (previous?.revision ?? 0) + 1,
      question: input.question,
      sceneId: input.sceneId,
      readingId: input.readingId,
      messages,
      candidate,
      plan: createResponsePlan(candidate, hasExistingCards),
    };
    controller.signal.throwIfAborted();
    await saveIntentSnapshot(userId, snapshot, previous?.id);
    return snapshot;
  } catch {
    // Never expose vendor payloads, credentials, or model-supplied errors.
    throw new HttpError(503, signal?.aborted ? '意图识别已取消' : '意图识别未完成，请重试');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

export async function loadIntentForReading(
  userId: string,
  id: string,
  question: string,
  context: { sceneId?: string; readingId?: string },
): Promise<IntentSnapshot> {
  const snapshot = await getIntentSnapshot(userId, id);
  const reading = context.readingId
    ? await getOwnedIntentReading(userId, context.readingId)
    : undefined;
  const sceneId = context.sceneId ?? reading?.sceneId;
  if (
    snapshot.version !== INTENT_VERSION ||
    snapshot.question !== question ||
    snapshot.sceneId !== sceneId ||
    (reading?.sceneId !== undefined && reading.sceneId !== snapshot.sceneId) ||
    (reading !== undefined && snapshot.readingId === undefined && reading.question !== question) ||
    snapshot.plan.mode === 'clarify' ||
    (snapshot.readingId !== undefined && snapshot.readingId !== context.readingId)
  )
    throw new HttpError(409, '问题或场景已变化，请重新识别意图');
  return snapshot;
}
