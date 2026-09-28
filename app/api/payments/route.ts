import type { NextRequest } from 'next/server';
import { requireUser } from '@/lib/server/auth';
import { apiError, HttpError, readJson } from '@/lib/server/http';
import { createRecharge, ownedOrder, preparePayment, wallet } from '@/lib/server/payments';
import { paymentEnabled } from '@/lib/server/huifu';

export const runtime = 'nodejs';
export async function GET(request: NextRequest) {
  try {
    const user = await requireUser(request);
    return Response.json(
      {
        ...(await wallet(user.id)),
        enabled: !user.isGuest && paymentEnabled(),
        guest: Boolean(user.isGuest),
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
    if (user.isGuest)
      throw new HttpError(403, '游客账号暂不支持微信支付，请从微信小程序登录后购买');
    const body = await readJson(request);
    if (Object.keys(body).some((key) => key !== 'planId'))
      throw new HttpError(400, '请仅提交充值方案');
    const requestUrl = new URL(request.url);
    const origin =
      request.headers.get('origin') ||
      `${requestUrl.protocol}//${request.headers.get('host') || requestUrl.host}`;
    const created = await createRecharge(user.id, body.planId, {
      returnUrl: new URL('/profile/credits', origin).href,
    });
    const result = await preparePayment(await ownedOrder(created.order.id, user.id));
    return Response.json(
      {
        order: result.order,
        ...('payment' in result && result.payment ? { url: result.payment.url } : {}),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return apiError(error);
  }
}
