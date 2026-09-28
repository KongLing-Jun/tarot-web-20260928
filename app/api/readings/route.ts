import { loadIntentForReading } from '@/lib/server/intent';
import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/server/auth';
import { database } from '@/lib/server/database';
import { apiError, HttpError, readJson } from '@/lib/server/http';
import { parseReading, recordId } from '@/lib/server/readings';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const offset = Number(request.nextUrl.searchParams.get('offset') ?? 0);
    if (!Number.isSafeInteger(offset) || offset < 0) throw new HttpError(400, '分页参数错误');
    const result = await database().query(
      'SELECT data FROM tarot_readings WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT 51 OFFSET $2',
      [user.id, offset],
    );
    return Response.json(
      {
        readings: result.rows.slice(0, 50).map((row) => row.data),
        hasMore: result.rows.length > 50,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const reading = parseReading(await readJson(request));
    if (reading.intentId)
      await loadIntentForReading(user.id, reading.intentId, reading.question, {
        sceneId: reading.sceneId,
      });
    for (const followUp of reading.followUps ?? []) {
      if (followUp.intentId)
        await loadIntentForReading(user.id, followUp.intentId, followUp.question, {
          readingId: reading.id,
          sceneId: reading.sceneId,
        });
    }
    await database().query(
      `INSERT INTO tarot_readings (user_id, id, data, created_at) VALUES ($1, $2, $3, $4)
      ON CONFLICT (user_id, id) DO UPDATE SET data = tarot_readings.data || EXCLUDED.data, updated_at = now()`,
      [user.id, reading.id, JSON.stringify(reading), reading.createdAt],
    );
    return Response.json({ saved: true });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const body = await readJson(request);
    if (body.all === true) {
      await database().query('DELETE FROM tarot_readings WHERE user_id = $1', [user.id]);
    } else {
      if (!Array.isArray(body.ids) || !body.ids.length || body.ids.length > 500)
        throw new HttpError(400, '请选择要删除的记录');
      await database().query(
        'DELETE FROM tarot_readings WHERE user_id = $1 AND id = ANY($2::text[])',
        [user.id, body.ids.map(recordId)],
      );
    }
    return Response.json({ deleted: true });
  } catch (error) {
    return apiError(error);
  }
}
