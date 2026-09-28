import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/server/auth';
import { database, transaction } from '@/lib/server/database';
import { apiError, HttpError, readJson } from '@/lib/server/http';
import { dailyColumns, dailyDate, dailyNote } from '@/lib/server/daily';
import { getDailyDraw, parseDateKey } from '@/lib/tarot/daily';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const offset = Number(request.nextUrl.searchParams.get('offset') ?? 0);
    if (!Number.isSafeInteger(offset) || offset < 0) throw new HttpError(400, '分页参数错误');
    const result = await database().query(
      `SELECT ${dailyColumns} FROM tarot_daily_entries
      WHERE user_id = $1 ORDER BY date_key DESC LIMIT 101 OFFSET $2`,
      [user.id, offset],
    );
    return Response.json(
      { entries: result.rows.slice(0, 100), hasMore: result.rows.length > 100 },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return apiError(error);
  }
}

// Explicit import of old device notes. Never overwrite a note already edited online.
export async function POST(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const body = await readJson(request);
    if (!Array.isArray(body.notes) || body.notes.length > 100)
      throw new HttpError(400, '札记导入格式错误');
    const notes = body.notes.map((entry: unknown) => {
      if (!entry || typeof entry !== 'object') throw new HttpError(400, '札记格式错误');
      const value = entry as Record<string, unknown>;
      return { dateKey: dailyDate(value.dateKey), note: dailyNote(value.note) };
    });
    const imported = await transaction(async (client) => {
      const dates: string[] = [];
      for (const entry of notes) {
        const draw = getDailyDraw(parseDateKey(entry.dateKey)!);
        const result = await client.query(
          `INSERT INTO tarot_daily_entries (user_id, date_key, card_id, is_reversed, note, note_updated_at)
          VALUES ($1, $2, $3, $4, $5, now()) ON CONFLICT (user_id, date_key) DO UPDATE
          SET note = EXCLUDED.note, note_updated_at = now(), updated_at = now()
          WHERE tarot_daily_entries.note_updated_at IS NULL RETURNING date_key`,
          [user.id, entry.dateKey, draw.card.id, draw.isReversed, entry.note],
        );
        if (result.rowCount) dates.push(entry.dateKey);
      }
      return dates;
    });
    return Response.json({ imported });
  } catch (error) {
    return apiError(error);
  }
}
