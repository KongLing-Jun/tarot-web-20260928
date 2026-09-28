import { NextRequest } from 'next/server';
import { hashToken, requireUser } from '@/lib/server/auth';
import { database } from '@/lib/server/database';
import { apiError, HttpError, readJson } from '@/lib/server/http';
import { PRODUCT_TOUR_VERSION, type ProductTourStatus } from '@/lib/product-tour';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'no-store' };
// Compare-only account binding, never a credential or a client-selected owner.
const accountScope = (userId: string) => hashToken(`product-tour:${userId}`);

async function readStatus(userId: string) {
  const result = await database().query<{ status: ProductTourStatus | null }>(
    `SELECT CASE WHEN product_tour_version >= $2 THEN product_tour_status ELSE NULL END AS status
     FROM tarot_users WHERE id = $1`,
    [userId, PRODUCT_TOUR_VERSION],
  );
  if (!result.rows[0]) throw new HttpError(401, '登录已过期，请重新登录');
  return result.rows[0].status;
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser(request);
    return Response.json(
      {
        version: PRODUCT_TOUR_VERSION,
        accountScope: accountScope(user.id),
        status: await readStatus(user.id),
      },
      { headers },
    );
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const body = await readJson(request);
    if (
      Object.keys(body).some((key) => !['version', 'accountScope', 'status'].includes(key)) ||
      body.version !== PRODUCT_TOUR_VERSION ||
      !['completed', 'skipped'].includes(body.status as string) ||
      typeof body.accountScope !== 'string' ||
      !/^[a-f0-9]{64}$/.test(body.accountScope)
    )
      throw new HttpError(400, '引导记录格式错误');
    if (body.accountScope !== accountScope(user.id))
      throw new HttpError(409, '账号已变化，请重新打开引导');

    await database().query(
      `UPDATE tarot_users SET product_tour_version = $2, product_tour_status = $3
       WHERE id = $1 AND (
         product_tour_version < $2
         OR (product_tour_version = $2 AND product_tour_status = 'skipped' AND $3 = 'completed')
       )`,
      [user.id, PRODUCT_TOUR_VERSION, body.status],
    );
    // Older clients cannot downgrade a newer version; return the effective state.
    return Response.json(
      {
        version: PRODUCT_TOUR_VERSION,
        accountScope: accountScope(user.id),
        status: await readStatus(user.id),
      },
      { headers },
    );
  } catch (error) {
    return apiError(error);
  }
}
