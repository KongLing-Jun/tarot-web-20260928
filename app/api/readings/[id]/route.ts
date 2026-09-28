import { loadIntentForReading } from '@/lib/server/intent';
import type { FollowUp } from '@/lib/tarot/types';
import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/server/auth';
import { database } from '@/lib/server/database';
import { apiError, HttpError, readJson } from '@/lib/server/http';
import { parseReadingPatch, recordId } from '@/lib/server/readings';
export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Context) {
  try {
    const user = await requireUser(request);
    const id = recordId((await context.params).id);
    const result = await database().query(
      'SELECT data FROM tarot_readings WHERE user_id = $1 AND id = $2',
      [user.id, id],
    );
    if (!result.rows[0]) throw new HttpError(404, '记录不存在');
    return Response.json(
      { reading: result.rows[0].data },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: NextRequest, context: Context) {
  try {
    const user = await requireUser(request);
    const id = recordId((await context.params).id);
    const patch = parseReadingPatch(await readJson(request));
    for (const followUp of (patch.followUps as FollowUp[] | undefined) ?? []) {
      if (followUp.intentId)
        await loadIntentForReading(user.id, followUp.intentId, followUp.question, {
          readingId: id,
        });
    }
    const result = await database().query(
      `UPDATE tarot_readings SET data = data || $3::jsonb ||
      CASE WHEN $3::jsonb ? 'followUps' THEN jsonb_build_object('followUps', COALESCE((
        SELECT jsonb_agg(item || COALESCE((
          SELECT jsonb_build_object('exchangeId', saved->'exchangeId')
          FROM jsonb_array_elements(COALESCE(data->'followUps', '[]'::jsonb)) saved
          WHERE saved->>'id' = item->>'id' AND saved ? 'exchangeId' LIMIT 1
        ), '{}'::jsonb) ORDER BY position)
        FROM jsonb_array_elements($3::jsonb->'followUps') WITH ORDINALITY AS f(item, position)
      ), '[]'::jsonb)) ELSE '{}'::jsonb END,
      updated_at = now() WHERE user_id = $1 AND id = $2`,
      [user.id, id, JSON.stringify(patch)],
    );
    if (!result.rowCount) throw new HttpError(404, '记录不存在');
    return Response.json({ saved: true });
  } catch (error) {
    return apiError(error);
  }
}
