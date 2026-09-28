import { NextRequest } from 'next/server';
import { allCards } from '@/lib/tarot/cards';
import { requireUser } from '@/lib/server/auth';
import { database } from '@/lib/server/database';
import { apiError, HttpError } from '@/lib/server/http';

export const runtime = 'nodejs';
type Context = { params: Promise<{ cardId: string }> };

async function saveFavorite(request: NextRequest, context: Context, favorited: boolean) {
  try {
    const user = await requireUser(request);
    const { cardId } = await context.params;
    if (!allCards.some((card) => card.id === cardId)) throw new HttpError(400, '这张牌不存在');
    if (favorited) {
      await database().query(
        `INSERT INTO tarot_card_favorites (user_id, card_id) VALUES ($1, $2)
        ON CONFLICT (user_id, card_id) DO NOTHING`,
        [user.id, cardId],
      );
    } else {
      await database().query(
        'DELETE FROM tarot_card_favorites WHERE user_id = $1 AND card_id = $2',
        [user.id, cardId],
      );
    }
    return Response.json({ cardId, favorited }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return apiError(error);
  }
}

export const PUT = (request: NextRequest, context: Context) => saveFavorite(request, context, true);
export const DELETE = (request: NextRequest, context: Context) =>
  saveFavorite(request, context, false);
