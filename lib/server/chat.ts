import { createHash, randomUUID } from 'node:crypto';
import { createSseDecoder, parseSseChunk } from '@/lib/tarot/sseUtils';
import { classifyGeneration, hasValidAnswer } from '@/lib/api/generation-result';
import { transaction } from './database';
import { dailyDate, ensureDailyEntry } from './daily';
import { HttpError } from './http';

export type ChatStatus = 'pending' | 'done' | 'error' | 'cancelled';

export async function startChatExchange(
  userId: string,
  question: string,
  context: {
    daily?: { dateKey?: string; dateStr: string };
    readingId?: string;
    followUp?: unknown;
    internal?: boolean;
    [key: string]: unknown;
  },
) {
  let exchangeId = randomUUID();
  let replyId = randomUUID();
  const operationId = typeof context.operationId === 'string' ? context.operationId : undefined;
  const attemptId = typeof context.attemptId === 'string' ? context.attemptId : randomUUID();
  const { operationId: _operationId, attemptId: _attemptId, ...requestContext } = context;
  void _operationId;
  void _attemptId;
  const fingerprint = createHash('sha256')
    .update(JSON.stringify({ question, context: requestContext }))
    .digest('hex');
  context = { ...context, attemptId, fingerprint };
  let replay: { content: string; status: ChatStatus; finishReason?: string } | undefined;
  const followUp =
    context.followUp && typeof context.followUp === 'object'
      ? (context.followUp as { id?: unknown; decision?: unknown; additionalCards?: unknown[] })
      : null;
  const followUpId = typeof followUp?.id === 'string' ? followUp.id : null;
  const followUpDetails = {
    ...(followUp?.decision === 'direct' || followUp?.decision === 'draw'
      ? { decision: followUp.decision }
      : {}),
    ...(Array.isArray(followUp?.additionalCards)
      ? {
          additionalCards: followUp.additionalCards,
          drawCount: followUp.additionalCards.length,
          revealedCount: followUp.additionalCards.length,
        }
      : {}),
  };
  const dateKey = context.daily
    ? dailyDate(context.daily.dateKey ?? context.daily.dateStr.replaceAll('.', '-'))
    : null;
  if (dateKey) await ensureDailyEntry(userId, dateKey);
  await transaction(async (client) => {
    let reuse = false;
    if (operationId) {
      // Serialize attempts of the same user operation without changing the database schema.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [
        userId,
        operationId,
      ]);
      const previous = await client.query(
        `SELECT id, exchange_id, content, status, context FROM tarot_chat_messages
        WHERE user_id = $1 AND role = 'assistant' AND context->>'operationId' = $2 FOR UPDATE`,
        [userId, operationId],
      );
      const saved = previous.rows[0];
      if (saved) {
        if (saved.context.fingerprint !== fingerprint)
          throw new HttpError(409, '请求标识已用于其他内容，请重新发起操作');
        if (saved.status === 'pending')
          throw new HttpError(409, '该回复仍在生成，请等待当前请求完成');
        if (hasValidAnswer(saved.content)) {
          replay = {
            content: saved.content,
            status: saved.status,
            finishReason: saved.context.finishReason,
          };
          return;
        }
        exchangeId = saved.exchange_id;
        replyId = saved.id;
        reuse = true;
        await client.query(
          `UPDATE tarot_chat_messages SET content = '', status = 'pending', context = $3, updated_at = now()
          WHERE user_id = $1 AND id = $2`,
          [userId, replyId, JSON.stringify(context)],
        );
      }
    }
    if (!reuse)
      await client.query(
        `INSERT INTO tarot_chat_messages (id, user_id, exchange_id, role, content, status, context)
      VALUES ($1, $2, $3, 'user', $4, 'done', $5), ($6, $2, $3, 'assistant', '', 'pending', $5)`,
        [randomUUID(), userId, exchangeId, question, JSON.stringify(context), replyId],
      );
    if (dateKey)
      await client.query(
        `UPDATE tarot_daily_entries SET exchange_id = $3, interpretation_status = 'pending', updated_at = now()
      WHERE user_id = $1 AND date_key = $2`,
        [userId, dateKey, exchangeId],
      );
    if (context.readingId && !context.followUp && !context.internal) {
      await client.query(
        `UPDATE tarot_readings SET data = data || jsonb_build_object('exchangeId', $3::text)
        WHERE user_id = $1 AND id = $2`,
        [userId, context.readingId, exchangeId],
      );
    }
    if (context.readingId && followUpId && !context.internal) {
      await client.query(
        `UPDATE tarot_readings SET data = jsonb_set(data, '{followUps}', (
        SELECT jsonb_agg(CASE WHEN item->>'id' = $3 THEN item || $4::jsonb ELSE item END ORDER BY position)
        FROM jsonb_array_elements(data->'followUps') WITH ORDINALITY AS f(item, position)
      )), updated_at = now() WHERE user_id = $1 AND id = $2
        AND jsonb_array_length(COALESCE(data->'followUps', '[]'::jsonb)) > 0`,
        [
          userId,
          context.readingId,
          followUpId,
          JSON.stringify({ exchangeId, status: 'interpreting', error: null, ...followUpDetails }),
        ],
      );
    }
  });

  const decoder = new TextDecoder();
  const frames = createSseDecoder();
  let content = '';
  let thinking = false;
  let done = false;
  let failed = false;
  let finishReason: string | undefined;
  let truncated = false;
  let lastSavedAt = Date.now();
  let finished: Promise<void> | undefined;
  let writes: Promise<void> = Promise.resolve();

  function parseData(data: string) {
    const parsed = parseSseChunk(data);
    done ||= parsed.isDone;
    finishReason = parsed.finishReason ?? finishReason;
    truncated ||= parsed.truncated;
    failed ||= Boolean(parsed.error);
    if (parsed.thinking) {
      if (!thinking) content += content ? '\n\n<think>\n' : '<think>\n';
      thinking = true;
      content += parsed.thinking;
    }
    if (parsed.content) {
      if (thinking) content += '\n</think>\n\n';
      thinking = false;
      content += parsed.content;
    }
  }

  function parse(text: string) {
    frames.push(text).forEach(parseData);
  }

  function save(status: ChatStatus): Promise<void> {
    const snapshot = content;
    const generationStatus =
      status === 'pending'
        ? 'running'
        : classifyGeneration({
            fullText: snapshot,
            done,
            finishReason,
            truncated,
            interrupted: failed || status === 'error',
            cancelled: status === 'cancelled',
          });
    writes = writes
      .catch(() => {})
      .then(async () => {
        await transaction(async (client) => {
          const written = await client.query(
            `UPDATE tarot_chat_messages SET content = $1, status = $2,
          context = context || $5::jsonb, updated_at = now() WHERE id = $3 AND user_id = $4 AND context->>'attemptId' = $6`,
            [
              snapshot,
              status,
              replyId,
              userId,
              JSON.stringify({ generationStatus, finishReason }),
              attemptId,
            ],
          );
          if (written.rowCount === 0) return;
          // A later request owns the daily result. Older streams retain their transcript only.
          if (dateKey)
            await client.query(
              `UPDATE tarot_daily_entries SET
          interpretation = CASE WHEN $3 <> '' THEN $3 ELSE interpretation END,
          interpretation_status = $4, updated_at = now()
          WHERE user_id = $1 AND date_key = $2 AND exchange_id = $5`,
              [userId, dateKey, snapshot, status, exchangeId],
            );
          if (context.readingId && !context.followUp && !context.internal && snapshot) {
            await client.query(
              `UPDATE tarot_readings SET data = data || jsonb_build_object('interpretation', $3::text, 'generationStatus', $5::text), updated_at = now()
            WHERE user_id = $1 AND id = $2 AND data->>'exchangeId' = $4`,
              [userId, context.readingId, snapshot, exchangeId, generationStatus],
            );
          }
          if (context.readingId && followUpId && !context.internal) {
            await client.query(
              `UPDATE tarot_readings SET data = jsonb_set(data, '{followUps}', (
            SELECT jsonb_agg(CASE WHEN item->>'id' = $3 AND item->>'exchangeId' = $4
              THEN item || $5::jsonb ELSE item END ORDER BY position)
            FROM jsonb_array_elements(data->'followUps') WITH ORDINALITY AS f(item, position)
          )), updated_at = now() WHERE user_id = $1 AND id = $2
            AND jsonb_array_length(COALESCE(data->'followUps', '[]'::jsonb)) > 0`,
              [
                userId,
                context.readingId,
                followUpId,
                exchangeId,
                JSON.stringify({
                  ...followUpDetails,
                  generationStatus,
                  interpretation: snapshot,
                  status:
                    status === 'pending' ? 'interpreting' : status === 'done' ? 'done' : 'error',
                  error:
                    status === 'error' || status === 'cancelled'
                      ? '上次追问未完成，已保留内容和牌面。'
                      : null,
                }),
              ],
            );
          }
        });
      });
    return writes;
  }

  return {
    replay,
    get complete() {
      return done || Boolean(finishReason);
    },
    async append(chunk: Uint8Array) {
      if (finished || replay) return;
      parse(decoder.decode(chunk, { stream: true }));
      if (Date.now() - lastSavedAt >= 2000) {
        lastSavedAt = Date.now();
        // Keep model transport independent of database latency; finish awaits the queued writes.
        void save('pending').catch(() => {});
      }
    },
    finish(status?: ChatStatus): Promise<void> {
      if (finished) return finished;
      if (replay) return Promise.resolve();
      parse(decoder.decode());
      frames.finish().forEach(parseData);
      if (thinking) content += '\n</think>\n\n';
      const generation = classifyGeneration({
        fullText: content,
        done,
        finishReason,
        truncated,
        interrupted: failed || status === 'error',
        cancelled: status === 'cancelled',
      });
      finished = save(
        generation === 'completed' ? 'done' : generation === 'cancelled' ? 'cancelled' : 'error',
      );
      return finished;
    },
  };
}

export type ChatRecorder = Awaited<ReturnType<typeof startChatExchange>>;
