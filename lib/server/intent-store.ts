import { INTENT_VERSION, type IntentSnapshot, type IntentMessage } from '@/lib/intent/types';
import { database } from './database';
import { HttpError } from './http';
import { parseDrawnCards, recordId } from './readings';

export async function getIntentSnapshot(userId: string, id: string): Promise<IntentSnapshot> {
  if (!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id))
    throw new HttpError(400, '意图记录 ID 无效');
  const result = await database().query<{ snapshot: IntentSnapshot }>(
    'SELECT snapshot FROM tarot_user_intents WHERE user_id = $1 AND id = $2',
    [userId, id],
  );
  if (!result.rows[0]) throw new HttpError(404, '意图记录不存在');
  return result.rows[0].snapshot;
}

export async function saveIntentSnapshot(
  userId: string,
  snapshot: IntentSnapshot,
  previousId?: string,
): Promise<void> {
  await database().query(
    'INSERT INTO tarot_user_intents (id, user_id, previous_id, revision, snapshot) VALUES ($1, $2, $3, $4, $5::jsonb)',
    [snapshot.id, userId, previousId ?? null, snapshot.revision, JSON.stringify(snapshot)],
  );
}

/** Only user-authored questions are evidence; never use generated interpretations. */
export async function getOwnedIntentReading(userId: string, id: string) {
  recordId(id);
  const result = await database().query<{
    data: {
      question?: string;
      sceneId?: string;
      intentId?: string;
      drawnCards?: unknown;
      followUps?: { id: string; question: string; intentId?: string }[];
    };
  }>('SELECT data FROM tarot_readings WHERE user_id = $1 AND id = $2', [userId, id]);
  if (!result.rows[0]) throw new HttpError(404, '记录不存在');
  return result.rows[0].data;
}

export async function getReadingIntentContext(userId: string, id: string) {
  const data = await getOwnedIntentReading(userId, id);
  const hasExistingCards = parseDrawnCards(data.drawnCards ?? []).length > 0;
  const messages: IntentMessage[] = [];
  const seenIds = new Map<string, string>();
  function append(message: IntentMessage) {
    const prior = seenIds.get(message.id);
    if (prior !== undefined && prior !== message.text)
      throw new HttpError(409, '意图历史依据不一致，请重新识别');
    if (prior === undefined) {
      seenIds.set(message.id, message.text);
      messages.push(message);
    }
  }
  async function appendQuestion(
    question: string | undefined,
    messageId: string,
    intentId?: string,
    followUp = false,
  ) {
    if (intentId) {
      const snapshot = await getIntentSnapshot(userId, intentId);
      if (
        snapshot.version !== INTENT_VERSION ||
        snapshot.question !== question ||
        snapshot.sceneId !== data.sceneId ||
        snapshot.messages.at(-1)?.text !== question ||
        snapshot.plan.mode === 'clarify' ||
        (followUp
          ? snapshot.readingId !== id
          : snapshot.readingId !== undefined && snapshot.readingId !== id)
      )
        throw new HttpError(409, '历史意图与占卜记录不一致，请重新识别');
      for (const message of snapshot.messages) append(message);
      return;
    }
    if (typeof question === 'string' && question.trim()) append({ id: messageId, text: question });
  }
  await appendQuestion(data.question, `reading:${id}`, data.intentId);
  for (const followUp of data.followUps ?? []) {
    await appendQuestion(
      followUp.question,
      `follow-up:${id}:${followUp.id}`,
      followUp.intentId,
      true,
    );
  }
  return { messages, sceneId: data.sceneId, hasExistingCards };
}

export async function getReadingIntentMessages(
  userId: string,
  id: string,
): Promise<IntentMessage[]> {
  return (await getReadingIntentContext(userId, id)).messages;
}
