import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/server/auth';
import { database } from '@/lib/server/database';
import { apiError, readJson } from '@/lib/server/http';
import { dailyColumns, dailyDate, dailyNote, ensureDailyEntry } from '@/lib/server/daily';

export const runtime = 'nodejs';
type Context = { params: Promise<{ date: string }> };

export async function GET(request: NextRequest, context: Context) {
  try {
    const user = await requireUser(request);
    const date = dailyDate((await context.params).date);
    const result = await database().query(
      `SELECT ${dailyColumns} FROM tarot_daily_entries WHERE user_id = $1 AND date_key = $2`,
      [user.id, date],
    );
    return Response.json(
      { entry: result.rows[0] ?? null },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return apiError(error);
  }
}

// Visiting the daily page registers the actual draw; PATCH changes only the note.
export async function POST(request: NextRequest, context: Context) {
  try {
    const user = await requireUser(request);
    const date = dailyDate((await context.params).date);
    await ensureDailyEntry(user.id, date);
    return GET(request, context);
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: NextRequest, context: Context) {
  try {
    const user = await requireUser(request);
    const date = dailyDate((await context.params).date);
    const note = dailyNote((await readJson(request)).note);
    await ensureDailyEntry(user.id, date);
    const result = await database().query(
      `UPDATE tarot_daily_entries SET note = $3, note_updated_at = now(), updated_at = now()
      WHERE user_id = $1 AND date_key = $2 RETURNING ${dailyColumns}`,
      [user.id, date, note],
    );
    return Response.json({ entry: result.rows[0] }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return apiError(error);
  }
}
