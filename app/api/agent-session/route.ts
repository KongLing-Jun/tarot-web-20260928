import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/server/auth';
import { database } from '@/lib/server/database';
import { apiError, HttpError, readJson } from '@/lib/server/http';
import { recordId } from '@/lib/server/readings';
import type { AgentTask } from '@/lib/agentSessionStorage';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const result = await database().query(
      `SELECT s.revision, COALESCE((
      SELECT jsonb_agg(t.task || jsonb_build_object('reading', r.data, 'completion',
        CASE WHEN m.status = 'done' THEN 'complete' WHEN m.status IS NOT NULL THEN 'incomplete' ELSE 'unknown' END)
        ORDER BY t.position)
      FROM jsonb_array_elements(s.tasks) WITH ORDINALITY AS t(task, position)
      LEFT JOIN tarot_readings r ON r.user_id = s.user_id AND r.id = t.task->>'readingId'
      LEFT JOIN tarot_chat_messages m ON m.user_id = s.user_id
        AND m.exchange_id::text = r.data->>'exchangeId' AND m.role = 'assistant'
    ), '[]'::jsonb) AS tasks FROM tarot_agent_sessions s WHERE s.user_id = $1`,
      [user.id],
    );
    return Response.json(result.rows[0] ?? { tasks: [], revision: 0 }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const body = await readJson(request);
    if (
      !Number.isSafeInteger(body.revision) ||
      (body.revision as number) < 0 ||
      !Array.isArray(body.tasks) ||
      body.tasks.length > 200
    )
      throw new HttpError(400, '对话任务格式错误');
    const tasks: AgentTask[] = body.tasks.map((value) => {
      if (
        !value ||
        typeof value !== 'object' ||
        typeof value.question !== 'string' ||
        !value.question.trim() ||
        value.question.length > 10000
      )
        throw new HttpError(400, '对话问题格式错误');
      return {
        id: recordId(value.id),
        question: value.question,
        readingId: recordId(value.readingId),
      };
    });
    if (
      new Set(tasks.map((task) => task.id)).size !== tasks.length ||
      new Set(tasks.map((task) => task.readingId)).size !== tasks.length
    )
      throw new HttpError(400, '对话任务重复');
    const result =
      body.revision === 0
        ? await database().query(
            `INSERT INTO tarot_agent_sessions (user_id, tasks, revision)
        VALUES ($1, $2::jsonb, 1) ON CONFLICT (user_id) DO NOTHING RETURNING revision`,
            [user.id, JSON.stringify(tasks)],
          )
        : await database().query(
            `UPDATE tarot_agent_sessions SET tasks = $2::jsonb,
        revision = revision + 1, updated_at = now() WHERE user_id = $1 AND revision = $3 RETURNING revision`,
            [user.id, JSON.stringify(tasks), body.revision],
          );
    if (result.rowCount) return Response.json(result.rows[0]);
    throw new HttpError(409, '对话已在其他页面或设备更新，请刷新后继续。');
  } catch (error) {
    return apiError(error);
  }
}
