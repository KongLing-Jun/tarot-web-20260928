import { apiError, HttpError } from '@/lib/server/http';
import { verifyNotification } from '@/lib/server/huifu';
import { applyPaymentResult } from '@/lib/server/payments';

export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    const text = await request.text();
    if (Buffer.byteLength(text) > 128_000) throw new HttpError(413, '支付通知过大');
    let envelope: Record<string, unknown>;
    try {
      envelope = request.headers.get('content-type')?.includes('application/json')
        ? JSON.parse(text)
        : Object.fromEntries(new URLSearchParams(text));
      if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) throw new Error();
    } catch {
      throw new HttpError(400, '支付通知格式错误');
    }
    const id = await applyPaymentResult(verifyNotification(envelope), 'notify');
    return new Response(`RECV_ORD_ID_${id}`, {
      headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return apiError(error);
  }
}
