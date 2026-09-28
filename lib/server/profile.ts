import type { CurrentUser } from '@/lib/auth/types';
import { DEFAULT_AVATAR, NICKNAME_HINT, isValidNickname } from '@/lib/auth/profile';
import { database } from './database';
import { HttpError } from './http';
import { normalizeAvatarImage } from './avatar-image';
import { getStaticImageUrl, saveAvatarImage } from './image-assets';

export async function updateProfile(
  userId: string,
  body: Record<string, unknown>,
): Promise<CurrentUser> {
  const keys = Object.keys(body);
  if (!keys.length || keys.some((key) => !['nickname', 'avatarUrl'].includes(key))) {
    throw new HttpError(400, '请提交头像或用户名');
  }
  const values: string[] = [userId];
  const updates: string[] = [];
  if ('nickname' in body) {
    if (!isValidNickname(body.nickname)) {
      throw new HttpError(400, `用户名需为 ${NICKNAME_HINT}`);
    }
    values.push(body.nickname.trim());
    updates.push(`nickname = $${values.length}`);
  }
  if ('avatarUrl' in body) {
    values.push(
      body.avatarUrl === DEFAULT_AVATAR
        ? await getStaticImageUrl(DEFAULT_AVATAR)
        : await saveAvatarImage(userId, await normalizeAvatarImage(body.avatarUrl)),
    );
    updates.push(`avatar_url = $${values.length}`);
  }
  const result = await database().query<
    Omit<CurrentUser, 'creditBalance'> & { creditBalance: string }
  >(
    `
      UPDATE tarot_users SET ${updates.join(', ')} WHERE id = $1
      RETURNING (guest_token_hash IS NOT NULL) AS "isGuest",
        CASE WHEN nickname = '星旅人_' || left(id::text, 8) THEN '星旅人' ELSE nickname END AS nickname,
        avatar_url AS "avatarUrl", created_at AS "createdAt", reading_count AS "readingCount",
        COALESCE((SELECT c.balance FROM tarot_user_credits c WHERE c.user_id = tarot_users.id), 0)::text AS "creditBalance",
        ARRAY(SELECT f.card_id FROM tarot_card_favorites f WHERE f.user_id = tarot_users.id ORDER BY f.created_at DESC, f.card_id) AS "favoriteCardIds"`,
    values,
  );
  if (!result.rows[0]) throw new HttpError(401, '登录已过期，请重新登录');
  return { ...result.rows[0], creditBalance: Number(result.rows[0].creditBalance) };
}
