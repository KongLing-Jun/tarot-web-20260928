import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { getServerSetting, getServerNumber } from '@/lib/api/server-config';
import type { CurrentUser } from '@/lib/auth/types';
import { database, transaction } from './database';
import { HttpError, checkOrigin } from './http';
import { getStaticImageUrl } from './image-assets';
import { DEFAULT_AVATAR } from '@/lib/auth/profile';

export const SESSION_COOKIE = 'tarot_session';
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const newToken = () => randomBytes(32).toString('hex');

// Internal identity is available only to server-side authorization code.
export interface AuthenticatedUser extends CurrentUser {
  id: string;
}

export function publicProfile(user: CurrentUser): CurrentUser {
  return {
    isGuest: user.isGuest,
    nickname: user.nickname,
    avatarUrl: user.avatarUrl,
    createdAt: user.createdAt,
    readingCount: user.readingCount,
    creditBalance: user.creditBalance,
    favoriteCardIds: user.favoriteCardIds,
  };
}

export async function loginWithGuest(
  credential: unknown,
  sessionSeconds = getServerNumber('SESSION_SECONDS'),
): Promise<string> {
  if (typeof credential !== 'string' || !/^[a-f0-9]{64}$/.test(credential))
    throw new HttpError(400, '游客登录凭证无效');
  const avatarUrl = await getStaticImageUrl(DEFAULT_AVATAR);
  return transaction(async (client) => {
    const result = await client.query<{ id: string }>(
      `
      INSERT INTO tarot_users (id, guest_token_hash, nickname, avatar_url)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (guest_token_hash) DO UPDATE SET last_login_at = now()
      RETURNING id`,
      [randomUUID(), hashToken(credential), '游客', avatarUrl],
    );
    const token = newToken();
    await client.query('DELETE FROM tarot_sessions WHERE expires_at < now()');
    await client.query(
      `INSERT INTO tarot_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + $3 * interval '1 second')`,
      [hashToken(token), result.rows[0].id, sessionSeconds],
    );
    return token;
  });
}

export async function loginWithWechat(code: unknown): Promise<string> {
  if (typeof code !== 'string' || !code.trim() || code.length > 512)
    throw new HttpError(400, '缺少有效微信登录凭证');
  const appId = getServerSetting('WECHAT_APP_ID');
  const secret = getServerSetting('WECHAT_APP_SECRET');
  if (!appId || !secret) throw new HttpError(503, '微信登录尚未配置，请联系管理员');
  const url = new URL('https://api.weixin.qq.com/sns/jscode2session');
  url.search = new URLSearchParams({
    appid: appId,
    secret,
    js_code: code,
    grant_type: 'authorization_code',
  }).toString();
  let identity;
  try {
    const response = await fetch(url, {
      cache: 'no-store',
      signal: AbortSignal.timeout(getServerNumber('WECHAT_TIMEOUT_MS')),
    });
    if (!response.ok) throw new Error();
    identity = await response.json();
  } catch {
    throw new HttpError(502, '无法连接微信登录服务，请重试');
  }
  if (identity.errcode || typeof identity.openid !== 'string' || !identity.openid) {
    throw new HttpError(401, '微信登录凭证无效或已过期，请重新登录');
  }
  // session_key intentionally never stored or sent to the browser.
  const id = randomUUID();
  const ticket = newToken();
  const defaultAvatarUrl = await getStaticImageUrl(DEFAULT_AVATAR);
  await transaction(async (client) => {
    const user = await client.query<{ id: string }>(
      `
      INSERT INTO tarot_users (id, wechat_app_id, wechat_open_id, wechat_union_id, nickname, avatar_url)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (wechat_app_id, wechat_open_id) DO UPDATE SET
        last_login_at = now(), wechat_union_id = COALESCE(EXCLUDED.wechat_union_id, tarot_users.wechat_union_id)
      RETURNING id`,
      [
        id,
        appId,
        identity.openid,
        typeof identity.unionid === 'string' ? identity.unionid : null,
        '星旅人',
        defaultAvatarUrl,
      ],
    );
    await client.query('DELETE FROM tarot_login_tickets WHERE expires_at < now()');
    await client.query('DELETE FROM tarot_sessions WHERE expires_at < now()');
    await client.query(
      `INSERT INTO tarot_login_tickets (token_hash, user_id, expires_at) VALUES ($1, $2, now() + $3 * interval '1 second')`,
      [hashToken(ticket), user.rows[0].id, getServerNumber('LOGIN_TICKET_SECONDS')],
    );
  });
  return ticket;
}

export async function consumeLoginTicket(
  ticket: string | null,
  sessionSeconds = getServerNumber('SESSION_SECONDS'),
): Promise<string> {
  if (!ticket || !/^[a-f0-9]{64}$/.test(ticket))
    throw new HttpError(401, '登录链接无效，请返回小程序重新登录');
  return transaction(async (client) => {
    // DELETE RETURNING makes simultaneous redemption/replay impossible.
    const result = await client.query<{ user_id: string }>(
      'DELETE FROM tarot_login_tickets WHERE token_hash = $1 AND expires_at > now() RETURNING user_id',
      [hashToken(ticket)],
    );
    if (!result.rows[0]) throw new HttpError(401, '登录链接已过期，请返回小程序重新登录');
    const token = newToken();
    await client.query(
      `INSERT INTO tarot_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + $3 * interval '1 second')`,
      [hashToken(token), result.rows[0].user_id, sessionSeconds],
    );
    return token;
  });
}

export async function requireUser(request: NextRequest): Promise<AuthenticatedUser> {
  if (!['GET', 'HEAD'].includes(request.method)) checkOrigin(request);
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) throw new HttpError(401, '请登录后使用');
  const result = await database().query<
    Omit<AuthenticatedUser, 'creditBalance'> & { creditBalance: string }
  >(
    `
    SELECT u.id, (u.guest_token_hash IS NOT NULL) AS "isGuest",
      CASE WHEN u.nickname = '星旅人_' || left(u.id::text, 8) THEN '星旅人' ELSE u.nickname END AS nickname,
      u.avatar_url AS "avatarUrl", u.created_at AS "createdAt", u.reading_count AS "readingCount",
      COALESCE((SELECT c.balance FROM tarot_user_credits c WHERE c.user_id = u.id), 0)::text AS "creditBalance",
      ARRAY(SELECT f.card_id FROM tarot_card_favorites f WHERE f.user_id = u.id ORDER BY f.created_at DESC, f.card_id) AS "favoriteCardIds"
    FROM tarot_sessions s JOIN tarot_users u ON u.id = s.user_id
    WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [hashToken(token)],
  );
  if (!result.rows[0]) throw new HttpError(401, '登录已过期，请重新登录');
  return { ...result.rows[0], creditBalance: Number(result.rows[0].creditBalance) };
}
