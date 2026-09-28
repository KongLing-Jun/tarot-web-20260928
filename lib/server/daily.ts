import { getDailyDraw, parseDateKey, formatDateKey } from '@/lib/tarot/daily';
import { database } from './database';
import { HttpError } from './http';

export function dailyDate(value: unknown): string {
  if (typeof value !== 'string') throw new HttpError(400, '日期格式错误');
  const date = parseDateKey(value);
  if (!date || formatDateKey(date) !== value)
    throw new HttpError(400, '日期无效，请使用 YYYY-MM-DD');
  return value;
}

export function dailyNote(value: unknown): string {
  if (typeof value !== 'string' || value.length > 10000)
    throw new HttpError(400, '札记最多可写 10000 字');
  return value.trim() ? value : '';
}

export const dailyColumns = `date_key::text AS "dateKey", card_id AS "cardId", is_reversed AS "isReversed",
  note, note_updated_at AS "updatedAt", interpretation, interpretation_status AS "interpretationStatus"`;

export async function ensureDailyEntry(userId: string, dateKey: string): Promise<void> {
  const draw = getDailyDraw(parseDateKey(dailyDate(dateKey))!);
  await database().query(
    `INSERT INTO tarot_daily_entries (user_id, date_key, card_id, is_reversed)
    VALUES ($1, $2, $3, $4) ON CONFLICT (user_id, date_key) DO NOTHING`,
    [userId, dateKey, draw.card.id, draw.isReversed],
  );
}
