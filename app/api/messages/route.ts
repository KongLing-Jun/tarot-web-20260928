import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/server/auth';
import { database } from '@/lib/server/database';
import { apiError, HttpError, readJson } from '@/lib/server/http';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const offset = Number(request.nextUrl.searchParams.get('offset') ?? 0);
    if (!Number.isSafeInteger(offset) || offset < 0) throw new HttpError(400, '分页参数错误');
    const result = await database().query(
      `SELECT id, exchange_id AS "exchangeId", role, content, status,
      context->>'generationStatus' AS "generationStatus",
      created_at AS "createdAt", updated_at AS "updatedAt" FROM tarot_chat_messages
      WHERE user_id = $1 AND COALESCE(context->>'internal', 'false') <> 'true'
      ORDER BY created_at DESC, exchange_id DESC, role ASC LIMIT 51 OFFSET $2`,
      [user.id, offset],
    );
    return Response.json(
      { messages: result.rows.slice(0, 50), hasMore: result.rows.length > 50 },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const body = await readJson(request);
    if (body.all !== true) throw new HttpError(400, '请确认清空聊天记录');
    await database().query('DELETE FROM tarot_chat_messages WHERE user_id = $1', [user.id]);
    return Response.json({ deleted: true });
  } catch (error) {
    return apiError(error);
  }
}
